import { collection, query, orderBy, onSnapshot, endAt, endBefore, getDocsFromServer, limit, limitToLast, startAfter, Timestamp, where, writeBatch } from 'firebase/firestore';
import { hasMsgData, openMsg } from '../../crypto/chat.js';
import { deleteAutoHiddenMessages } from './autodelete.js';
import { compactMessages } from './compact.js';
import { deleteMsgs } from './write.js';
import {
    CHAT_DELETE_SCAN_BATCH_SIZE as CONFIG_CHAT_DELETE_SCAN_BATCH_SIZE,
    CHAT_MESSAGE_BATCH_SIZE,
    CHAT_MESSAGE_QUERY_MAX_DOCS,
    CHAT_TTL_CLIENT_DELETE_GRACE_MS,
    CHAT_TTL_DELETE_CHUNK_SIZE,
} from '../../config.js';
import { collectMessageKeys, messageKeys } from '../messagekeys.js';
import { canShowMsg, canStoreMsg, collapseSystemMessages, getDisplayMessages, isExpiredMsg, savedMediaStayRef } from '../messages.js';
import { getCachedPair } from '../pairs.js';
import { getChatPeerPK } from '../ids.js';
import { sameBytes, sameHead } from '../equal.js';
import { positiveInt } from '../../utils/number.js';
import { cleanText } from '../../utils/text.js';
import { timestampKey, timestampMs } from '../../utils/time.js';

export const MSG_BATCH_SIZE = CHAT_MESSAGE_BATCH_SIZE;
export const MSG_QUERY_MAX_DOCS = CHAT_MESSAGE_QUERY_MAX_DOCS;
const TTL_CLIENT_DELETE_GRACE_MS = CHAT_TTL_CLIENT_DELETE_GRACE_MS;
const TTL_DELETE_CHUNK_SIZE = CHAT_TTL_DELETE_CHUNK_SIZE;
const CHAT_DELETE_SCAN_BATCH_SIZE = CONFIG_CHAT_DELETE_SCAN_BATCH_SIZE;
const pendingTtlDeleteKeys = new Set();

function messageDataExpired(msgData, now = Date.now()) {
    return isExpiredMsg({ ttl: msgData?.ttl ?? null }, now);
}

function messageDataClientDeleteExpired(msgData, now = Date.now()) {
    const ttlMs = timestampMs(msgData?.ttl, null);
    return ttlMs != null && ttlMs <= now - TTL_CLIENT_DELETE_GRACE_MS;
}

function messageDocDeleteKey(docSnap) {
    return docSnap?.ref?.path || docSnap?.id || null;
}

async function deleteExpiredMessageDocs(db, docSnaps) {
    if (!db) {
        return;
    }

    const targets = [];
    for (const docSnap of docSnaps || []) {
        const ref = docSnap?.ref;
        const key = messageDocDeleteKey(docSnap);
        if (!ref || !key || pendingTtlDeleteKeys.has(key) || docSnap.metadata?.hasPendingWrites) {
            continue;
        }
        pendingTtlDeleteKeys.add(key);
        targets.push({ key, ref });
    }

    try {
        for (let index = 0; index < targets.length; index += TTL_DELETE_CHUNK_SIZE) {
            const chunk = targets.slice(index, index + TTL_DELETE_CHUNK_SIZE);
            const batch = writeBatch(db);
            for (const item of chunk) {
                batch.delete(item.ref);
            }
            await batch.commit();
        }
    } catch {
        // Best-effort cleanup: rendering already hides expired docs.
    } finally {
        for (const item of targets) {
            pendingTtlDeleteKeys.delete(item.key);
        }
    }
}

function scheduleExpiredMessageDeletes(db, docSnaps) {
    if (docSnaps?.length) {
        void deleteExpiredMessageDocs(db, docSnaps);
    }
}

function scheduleAutoHiddenMessageDeletes(db, chatId, messages, chatPK, peerChatPK) {
    if (!messages?.length) {
        return;
    }
    void deleteAutoHiddenMessages({
        chatId,
        messages,
        chatPK,
        peerChatPK,
        deleteMessages: (targets) => deleteMsgs(db, chatId, targets),
    })
        .then((deleted) => {
            if (!deleted?.length) {
                return;
            }
            return compactMessages({
                chatId,
                messages,
                deletedKeys: collectMessageKeys(deleted),
                deleteMessages: (targets) => deleteMsgs(db, chatId, targets),
            });
        })
        .catch(() => {});
}

function scheduleMessageCompaction(db, chatId, messages, deletedKeys) {
    if (!messages?.length) {
        return;
    }
    void compactMessages({
        chatId,
        messages,
        deletedKeys,
        deleteMessages: (targets) => deleteMsgs(db, chatId, targets),
    }).catch(() => {});
}

function partitionExpiredMessageDocs(docs, expiredKeys, cache, now = Date.now()) {
    const activeDocs = [];
    const expiredDocs = [];

    for (const docSnap of docs || []) {
        const msgData = docSnap.data();
        if (!messageDataExpired(msgData, now)) {
            activeDocs.push(docSnap);
            continue;
        }

        addMessageDocKeys(expiredKeys, docSnap);
        cache?.delete?.(docSnap.id);
        if (messageDataClientDeleteExpired(msgData, now)) {
            expiredDocs.push(docSnap);
        }
    }

    return { activeDocs, expiredDocs };
}

function addMessageDocKeys(keys, docSnap) {
    if (!keys || !docSnap) {
        return;
    }
    if (docSnap.id) {
        keys.add(docSnap.id);
    }
    const cid = docSnap.data?.()?.head?.cid;
    const key = cleanText(cid);
    if (key) {
        keys.add(key);
    }
}

function getCursorMillis(cursor) {
    if (typeof cursor?.data === 'function') {
        return null;
    }
    if (Number.isFinite(cursor?.ms)) {
        return cursor.ms;
    }
    return timestampMs(cursor, null) ?? timestampMs(cursor?.ts, null);
}

function normalizeDecryptedMsg(msgData, message) {
    if (!message || typeof message !== 'object') {
        return null;
    }

    const normalized = {
        ...message,
        ts: msgData?.ts ?? null,
        ttl: msgData?.ttl ?? null,
    };
    return canStoreMsg(normalized) ? normalized : null;
}

function messageDocDataEqual(a, b) {
    if (a === b) {
        return true;
    }
    return !!a && !!b && sameHead(a?.head, b?.head) && sameBytes(a?.body, b?.body) && timestampKey(a?.ttl ?? null) === timestampKey(b?.ttl ?? null) && timestampKey(a?.ts ?? null) === timestampKey(b?.ts ?? null);
}

function messageDocsEqual(prev, docs) {
    if (!Array.isArray(prev) || !Array.isArray(docs) || prev.length !== docs.length) {
        return false;
    }
    for (let index = 0; index < docs.length; index += 1) {
        const docSnap = docs[index];
        const cached = prev[index];
        if (cached?.id !== docSnap.id || !messageDocDataEqual(cached.data, docSnap.data())) {
            return false;
        }
    }
    return true;
}

function cachedMessageBody(cacheEntry, msgData, docId) {
    const head = msgData?.head;
    if (!cacheEntry || !head || cacheEntry.from !== head.from || cacheEntry.cid !== head.cid || !sameBytes(cacheEntry.body, msgData?.body)) {
        return null;
    }

    const tsKey = timestampKey(msgData?.ts ?? null);
    const ttlKey = timestampKey(msgData?.ttl ?? null);
    if (cacheEntry.tsKey === tsKey && cacheEntry.ttlKey === ttlKey) {
        return cacheEntry.message;
    }

    cacheEntry.tsKey = tsKey;
    cacheEntry.ttlKey = ttlKey;
    cacheEntry.message = {
        ...cacheEntry.message,
        id: docId,
        ts: msgData?.ts ?? null,
        ttl: msgData?.ttl ?? null,
    };
    return cacheEntry.message;
}

function cacheMessageBody(cache, docId, msgData, message) {
    if (!cache || !docId || !message) {
        return;
    }

    const next = { ...message, id: docId };
    cache.set(docId, {
        from: msgData?.head?.from,
        cid: msgData?.head?.cid,
        body: msgData?.body,
        tsKey: timestampKey(msgData?.ts ?? null),
        ttlKey: timestampKey(msgData?.ttl ?? null),
        message: next,
    });
    return next;
}

async function decryptDoc(docSnap, userChatPK, userPrivKey, peerChatPK, cache) {
    const msgData = docSnap.data();
    if (messageDataExpired(msgData)) {
        cache?.delete?.(docSnap.id);
        return null;
    }

    const cached = cachedMessageBody(cache?.get?.(docSnap.id), msgData, docSnap.id);
    if (cached) {
        return cached;
    }

    const dec = await decryptMsg(msgData, userChatPK, userPrivKey, peerChatPK);
    if (!dec) {
        cache?.delete?.(docSnap.id);
        return null;
    }

    return cacheMessageBody(cache, docSnap.id, msgData, dec) ?? { ...dec, id: docSnap.id };
}

function pruneMessageCache(cache, docs) {
    if (!cache?.size) {
        return;
    }
    const keep = new Set((docs || []).map((docSnap) => docSnap.id).filter(Boolean));
    for (const id of cache.keys()) {
        if (!keep.has(id)) {
            cache.delete(id);
        }
    }
}

async function decryptDocEntries(docs, userChatPK, userPrivKey, peerChatPK, cache) {
    const entries = await Promise.all(
        docs.map(async (docSnap) => {
            const message = await decryptDoc(docSnap, userChatPK, userPrivKey, peerChatPK, cache);
            return message ? { doc: docSnap, message } : null;
        })
    );
    return entries.filter(Boolean);
}

function messageQueryLimit(pageSize) {
    return positiveInt(pageSize, MSG_BATCH_SIZE);
}

function messageQueryMax(pageSize) {
    return Math.max(messageQueryLimit(pageSize), MSG_QUERY_MAX_DOCS);
}

function nextMessageQueryLimit(current, max) {
    return Math.min(max, Math.max(current + 1, current * 2));
}

function readableEntryIndexes(entries, chatPK, peerChatPK) {
    const source = entries || [];
    const entryIndexByKey = new Map();
    for (let index = 0; index < source.length; index += 1) {
        for (const key of messageKeys(source[index]?.message)) {
            if (!entryIndexByKey.has(key)) {
                entryIndexByKey.set(key, index);
            }
        }
    }

    const messages = source.map((entry) => entry?.message).filter(Boolean);
    const visibleMessages = collapseSystemMessages(getDisplayMessages(messages, chatPK, peerChatPK)).filter(canShowMsg);
    const seen = new Set();
    const indexes = [];
    for (const message of visibleMessages) {
        for (const key of messageKeys(message)) {
            const index = entryIndexByKey.get(key);
            if (index == null || seen.has(index)) {
                continue;
            }
            seen.add(index);
            indexes.push(index);
            break;
        }
    }
    return indexes;
}

function readableEntryWindow(entries, pageSize, chatPK, peerChatPK) {
    const source = entries || [];
    const limitCount = positiveInt(pageSize, MSG_BATCH_SIZE);
    const indexes = readableEntryIndexes(source, chatPK, peerChatPK);

    if (indexes.length < limitCount) {
        return { count: indexes.length, entries: source };
    }

    const start = indexes[indexes.length - limitCount] ?? 0;
    return { count: indexes.length, entries: source.slice(start) };
}

function docIndexById(docs, id) {
    if (!id) {
        return -1;
    }
    return (docs || []).findIndex((docSnap) => docSnap.id === id);
}

export async function decryptMsg(msgData, userChatPK, userPrivKey, peerChatPK) {
    if (!hasMsgData(msgData) || !userChatPK || !userPrivKey || !peerChatPK) {
        return null;
    }
    if (messageDataExpired(msgData)) {
        return null;
    }

    try {
        const pair = await getCachedPair(userChatPK, userPrivKey, peerChatPK);
        const message = await openMsg(pair, msgData);
        return normalizeDecryptedMsg(msgData, message);
    } catch {
        return null;
    }
}

export async function collectSavedMediaStays(db, chatId, userChatPK, userPrivKey, peerChatPK, options = {}) {
    if (!db || !chatId || !userChatPK || !userPrivKey || !peerChatPK) {
        return [];
    }

    const batchSize = positiveInt(options?.batchSize, CHAT_DELETE_SCAN_BATCH_SIZE);
    const stays = new Map();
    let cursor = null;

    for (;;) {
        const clauses = [collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc')];
        if (cursor) {
            clauses.push(startAfter(cursor));
        }
        clauses.push(limit(batchSize));

        const snap = await getDocsFromServer(query(...clauses));
        if (snap.empty) {
            break;
        }

        const entries = await Promise.all(
            snap.docs.map(async (docSnap) => {
                const message = await decryptMsg(docSnap.data(), userChatPK, userPrivKey, peerChatPK);
                return message ? savedMediaStayRef(message) : null;
            })
        );
        for (const stay of entries) {
            if (!stay) {
                continue;
            }
            stays.set(`${stay.path}:${stay.stayId}:${stay.stayKey}`, stay);
        }

        cursor = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < batchSize) {
            break;
        }
    }

    return [...stays.values()];
}

export async function collectAccountSavedMediaStays(db, userChatPK, userPrivKey, options = {}) {
    if (!db || !userChatPK || !userPrivKey) {
        return [];
    }

    const chatsSnap = await getDocsFromServer(query(collection(db, 'chats'), where('participants', 'array-contains', userChatPK)));
    const stays = new Map();

    for (const chatSnap of chatsSnap.docs) {
        const peerChatPK = getChatPeerPK({ id: chatSnap.id, participants: chatSnap.data()?.participants }, userChatPK);
        if (!peerChatPK) {
            continue;
        }

        const chatStays = await collectSavedMediaStays(db, chatSnap.id, userChatPK, userPrivKey, peerChatPK, options).catch(() => []);
        for (const stay of chatStays) {
            stays.set(`${stay.path}:${stay.stayId}:${stay.stayKey}`, stay);
        }
    }

    return [...stays.values()];
}

export function listenToLatestMsgs(db, chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError) {
    const queryLimit = messageQueryLimit(pageSize);
    const maxQueryLimit = messageQueryMax(pageSize);
    const decryptedCache = new Map();
    let lastVisibleDocs = null;
    let lastExpiredKeys = '';
    let lastDeletedKeys = '';
    let unsub = null;
    let closed = false;
    let run = 0;

    function listen(limitCount) {
        const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), limitToLast(limitCount));
        unsub = onSnapshot(
            q,
            { includeMetadataChanges: true },
            async (snap) => {
                if (closed) {
                    return;
                }

                if (snap.metadata?.fromCache) {
                    onUpdate({
                        messages: [],
                        cursor: null,
                        carry: null,
                        hasOlder: false,
                        hasMore: false,
                        exists: true,
                        fromCache: true,
                    });
                    return;
                }

                const runId = ++run;
                const now = Date.now();
                const changeTypeById = new Map(snap.docChanges().map((change) => [change.doc.id, change.type]));
                const expiredKeys = new Set();
                const removedDocs = [];
                for (const change of snap.docChanges()) {
                    if (change.type === 'removed' && messageDataExpired(change.doc.data(), now)) {
                        addMessageDocKeys(expiredKeys, change.doc);
                    } else if (change.type === 'removed' && !change.doc.metadata.hasPendingWrites) {
                        removedDocs.push(change.doc);
                    }
                }
                const { activeDocs, expiredDocs } = partitionExpiredMessageDocs(snap.docs, expiredKeys, decryptedCache, now);
                scheduleExpiredMessageDeletes(db, expiredDocs);
                const docs = activeDocs.filter((docSnap) => {
                    if (!docSnap.metadata.hasPendingWrites) {
                        return true;
                    }

                    // Keep edited messages visible for the local sender while their
                    // body update is pending. Brand-new pending docs stay owned by
                    // localByChat until acked.
                    return changeTypeById.get(docSnap.id) === 'modified';
                });
                const allEntries = await decryptDocEntries(docs, userChatPK, userPrivKey, peerChatPK, decryptedCache);
                if (runId !== run) {
                    return;
                }
                scheduleAutoHiddenMessageDeletes(
                    db,
                    chatId,
                    allEntries.map((entry) => entry.message),
                    userChatPK,
                    peerChatPK
                );
                scheduleMessageCompaction(
                    db,
                    chatId,
                    allEntries.map((entry) => entry.message),
                    expiredKeys
                );
                let readableWindow = readableEntryWindow(allEntries, pageSize, userChatPK, peerChatPK);
                if (readableWindow.count < queryLimit && snap.docs.length >= limitCount && limitCount < maxQueryLimit) {
                    const nextLimit = nextMessageQueryLimit(limitCount, maxQueryLimit);
                    unsub?.();
                    if (!closed) {
                        listen(nextLimit);
                    }
                    return;
                }

                const entries = readableWindow.entries;
                const visibleDocs = entries.map((entry) => entry.doc);
                const visibleStart = docIndexById(docs, visibleDocs[0]?.id);
                const carry = visibleStart > 0 ? docs[visibleStart - 1] : null;
                const queryFilled = snap.docs.length >= limitCount;
                const queryStartMs = timestampMs(docs[0]?.data?.()?.ts, null);
                const deletedKeys = new Set();
                for (const docSnap of removedDocs) {
                    const removedMs = timestampMs(docSnap.data()?.ts, null);
                    if (!queryFilled || queryStartMs == null || removedMs == null || removedMs >= queryStartMs) {
                        addMessageDocKeys(deletedKeys, docSnap);
                    }
                }
                const expiredKeysKey = [...expiredKeys].sort().join('|');
                const deletedKeysKey = [...deletedKeys].sort().join('|');
                if (messageDocsEqual(lastVisibleDocs, visibleDocs) && expiredKeysKey === lastExpiredKeys && deletedKeysKey === lastDeletedKeys) {
                    return;
                }
                pruneMessageCache(decryptedCache, visibleDocs);
                const messages = entries.map((entry) => entry.message);
                const cursor = visibleDocs[0] ?? docs[0] ?? snap.docs[0] ?? null;
                lastVisibleDocs = visibleDocs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
                lastExpiredKeys = expiredKeysKey;
                lastDeletedKeys = deletedKeysKey;
                onUpdate({
                    messages,
                    cursor,
                    carry,
                    hasOlder: visibleStart > 0 || queryFilled,
                    hasMore: visibleStart > 1 || queryFilled,
                    exists: true,
                    fromCache: !!snap.metadata?.fromCache,
                    expiredKeys: [...expiredKeys],
                    deletedKeys: [...deletedKeys],
                });
            },
            onError
        );
    }

    listen(queryLimit);
    return () => {
        closed = true;
        unsub?.();
    };
}

export async function loadOlderMsgs(db, chatId, userChatPK, userPrivKey, peerChatPK, cursor, pageSize) {
    if (!cursor) {
        return {
            messages: [],
            cursor: null,
            hasMore: false,
        };
    }

    try {
        const queryLimit = messageQueryLimit(pageSize);
        const maxQueryLimit = messageQueryMax(pageSize);
        const cursorMs = getCursorMillis(cursor);
        const usingSnapshotCursor = cursorMs == null;
        const q = usingSnapshotCursor
            ? query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), endAt(cursor), limitToLast(queryLimit + 1))
            : query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), endBefore(Timestamp.fromMillis(cursorMs)), limitToLast(queryLimit));
        const snap = await getDocsFromServer(q);
        let rawDocs = usingSnapshotCursor ? snap.docs.slice(0, -1) : snap.docs;
        let filledQuery = usingSnapshotCursor ? snap.docs.length >= queryLimit + 1 : snap.docs.length >= queryLimit;
        const expiredKeys = new Set();
        let partitionedDocs = partitionExpiredMessageDocs(rawDocs, expiredKeys);
        scheduleExpiredMessageDeletes(db, partitionedDocs.expiredDocs);
        let olderDocs = partitionedDocs.activeDocs;
        let allEntries = await decryptDocEntries(olderDocs, userChatPK, userPrivKey, peerChatPK);
        scheduleAutoHiddenMessageDeletes(
            db,
            chatId,
            allEntries.map((entry) => entry.message),
            userChatPK,
            peerChatPK
        );
        scheduleMessageCompaction(
            db,
            chatId,
            allEntries.map((entry) => entry.message),
            expiredKeys
        );

        let readableWindow = readableEntryWindow(allEntries, pageSize, userChatPK, peerChatPK);
        while (readableWindow.count < queryLimit && rawDocs.length < maxQueryLimit && filledQuery && rawDocs[0]) {
            const nextLimit = Math.min(queryLimit, maxQueryLimit - rawDocs.length);
            const nextSnap = await getDocsFromServer(query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), endBefore(rawDocs[0]), limitToLast(nextLimit)));
            if (!nextSnap.docs.length) {
                filledQuery = false;
                break;
            }
            rawDocs = [...nextSnap.docs, ...rawDocs];
            filledQuery = nextSnap.docs.length >= nextLimit;
            partitionedDocs = partitionExpiredMessageDocs(rawDocs, expiredKeys);
            scheduleExpiredMessageDeletes(db, partitionedDocs.expiredDocs);
            olderDocs = partitionedDocs.activeDocs;
            allEntries = await decryptDocEntries(olderDocs, userChatPK, userPrivKey, peerChatPK);
            scheduleAutoHiddenMessageDeletes(
                db,
                chatId,
                allEntries.map((entry) => entry.message),
                userChatPK,
                peerChatPK
            );
            scheduleMessageCompaction(
                db,
                chatId,
                allEntries.map((entry) => entry.message),
                expiredKeys
            );
            readableWindow = readableEntryWindow(allEntries, pageSize, userChatPK, peerChatPK);
        }

        const entries = readableWindow.entries;
        const visibleDocs = entries.map((entry) => entry.doc);
        const visibleStart = docIndexById(olderDocs, visibleDocs[0]?.id);
        const messages = entries.map((entry) => entry.message);
        const nextCursor = visibleDocs[0] ?? olderDocs[0] ?? rawDocs[0] ?? null;

        return {
            messages,
            cursor: nextCursor,
            hasMore: visibleStart > 0 || filledQuery,
        };
    } catch {
        return {
            messages: [],
            cursor: null,
            hasMore: false,
        };
    }
}
