import { collection, query, orderBy, onSnapshot, endAt, endBefore, getDocsFromServer, limitToLast, Timestamp } from 'firebase/firestore';
import { hasMsgData, openMsg } from '../../crypto/chat.js';
import { canShowMsg, canStoreMsg, isExpiredMsg } from '../messages.js';
import { getCachedPair } from '../pairs.js';
import { toMillis, valueMillis } from '../time.js';

export const MSG_BATCH_SIZE = 40;
const MSG_QUERY_MULTIPLIER = 3;
const MSG_QUERY_EXTRA = 8;

function messageDataExpired(msgData, now = Date.now()) {
    return isExpiredMsg({ ttl: msgData?.ttl ?? null }, now);
}

function addMessageDocKeys(keys, docSnap) {
    if (!keys || !docSnap) {
        return;
    }
    if (docSnap.id) {
        keys.add(docSnap.id);
    }
    const cid = docSnap.data?.()?.head?.cid;
    if (typeof cid === 'string' && cid.trim()) {
        keys.add(cid.trim());
    }
}

function getCursorMillis(cursor) {
    if (typeof cursor?.data === 'function') {
        return null;
    }
    if (Number.isFinite(cursor?.ms)) {
        return cursor.ms;
    }
    if (typeof cursor?.toMillis === 'function') {
        const ms = cursor.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof cursor?.ts?.toMillis === 'function') {
        const ms = cursor.ts.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    return null;
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

function bytesEqual(a, b) {
    if (a === b) {
        return true;
    }
    if (typeof a?.isEqual === 'function') {
        return a.isEqual(b);
    }
    if (typeof b?.isEqual === 'function') {
        return b.isEqual(a);
    }
    if (typeof a?.toUint8Array !== 'function' || typeof b?.toUint8Array !== 'function') {
        return false;
    }

    const left = a.toUint8Array();
    const right = b.toUint8Array();
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}

function messageDocDataEqual(a, b) {
    if (a === b) {
        return true;
    }
    return !!a && !!b && headsEqual(a?.head, b?.head) && bytesEqual(a?.body, b?.body) && valueMillis(a?.ttl ?? null) === valueMillis(b?.ttl ?? null) && valueMillis(a?.ts ?? null) === valueMillis(b?.ts ?? null);
}

function headsEqual(a, b) {
    if (a === b) {
        return true;
    }
    return a?.from === b?.from && a?.cid === b?.cid;
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
    if (!cacheEntry || !head || cacheEntry.from !== head.from || cacheEntry.cid !== head.cid || !bytesEqual(cacheEntry.body, msgData?.body)) {
        return null;
    }

    const tsKey = valueMillis(msgData?.ts ?? null);
    const ttlKey = valueMillis(msgData?.ttl ?? null);
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
        tsKey: valueMillis(msgData?.ts ?? null),
        ttlKey: valueMillis(msgData?.ttl ?? null),
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

function positiveInt(value, fallback) {
    const next = Math.trunc(Number(value));
    return Number.isFinite(next) && next > 0 ? next : fallback;
}

function messageQueryLimit(pageSize) {
    return positiveInt(pageSize, MSG_BATCH_SIZE) * MSG_QUERY_MULTIPLIER + MSG_QUERY_EXTRA;
}

function trimEntriesToVisiblePage(entries, pageSize) {
    const limitCount = positiveInt(pageSize, MSG_BATCH_SIZE);
    let visibleCount = 0;
    let start = entries.length;

    for (let index = entries.length - 1; index >= 0; index -= 1) {
        start = index;
        if (canShowMsg(entries[index]?.message)) {
            visibleCount += 1;
        }
        if (visibleCount >= limitCount) {
            break;
        }
    }

    return entries.slice(Math.max(0, start));
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

export function listenToMsgs(db, chatId, userChatPK, userPrivKey, peerChatPK, onUpdate, onError) {
    let knownIds = [];
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'));

    return onSnapshot(
        q,
        async (snap) => {
            const changes = await Promise.all(
                snap.docChanges().map(async (ch) => {
                    if (ch.doc.metadata.hasPendingWrites) {
                        return null;
                    }
                    if (ch.type === 'removed') {
                        return { id: ch.doc.id, type: 'removed' };
                    }

                    const dec = await decryptMsg(ch.doc.data(), userChatPK, userPrivKey, peerChatPK);
                    return dec ? { ...dec, id: ch.doc.id, type: ch.type } : null;
                })
            );

            const next = changes.filter(Boolean);
            const added = next.filter((msg) => msg.type === 'added');
            const updated = next.filter((msg) => msg.type === 'modified');
            const removed = next.filter((msg) => msg.type === 'removed').map((msg) => msg.id);

            if (added.length || updated.length || removed.length) {
                const nextIds = new Set(knownIds);
                added.forEach((msg) => nextIds.add(msg.id));
                updated.forEach((msg) => nextIds.add(msg.id));
                removed.forEach((id) => nextIds.delete(id));
                knownIds = [...nextIds];
                onUpdate(chatId, added, updated, removed);
            }
        },
        onError
    );
}

export function listenToLatestMsgs(db, chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError) {
    const queryLimit = messageQueryLimit(pageSize);
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), limitToLast(queryLimit));
    const decryptedCache = new Map();
    let lastVisibleDocs = [];
    let lastExpiredKeys = '';
    let lastDeletedKeys = '';
    let run = 0;

    return onSnapshot(
        q,
        { includeMetadataChanges: true },
        async (snap) => {
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
            const changeTypeById = new Map(snap.docChanges().map((change) => [change.doc.id, change.type]));
            const expiredKeys = new Set();
            const removedDocs = [];
            for (const change of snap.docChanges()) {
                if (change.type === 'removed' && messageDataExpired(change.doc.data())) {
                    addMessageDocKeys(expiredKeys, change.doc);
                } else if (change.type === 'removed' && !change.doc.metadata.hasPendingWrites) {
                    removedDocs.push(change.doc);
                }
            }
            const docs = snap.docs.filter((docSnap) => {
                if (messageDataExpired(docSnap.data())) {
                    addMessageDocKeys(expiredKeys, docSnap);
                    decryptedCache.delete(docSnap.id);
                    return false;
                }
                if (!docSnap.metadata.hasPendingWrites) {
                    return true;
                }

                // Keep edited messages visible for the local sender while their
                // body update is pending. Brand-new pending docs stay owned by
                // localByChat until acked.
                return changeTypeById.get(docSnap.id) === 'modified';
            });
            const entries = trimEntriesToVisiblePage(await decryptDocEntries(docs, userChatPK, userPrivKey, peerChatPK, decryptedCache), pageSize);
            if (runId !== run) {
                return;
            }
            const visibleDocs = entries.map((entry) => entry.doc);
            const visibleStart = docIndexById(docs, visibleDocs[0]?.id);
            const carry = visibleStart > 0 ? docs[visibleStart - 1] : null;
            const queryFilled = snap.docs.length >= queryLimit;
            const queryStartMs = toMillis(docs[0]?.data?.()?.ts, null);
            const deletedKeys = new Set();
            for (const docSnap of removedDocs) {
                const removedMs = toMillis(docSnap.data()?.ts, null);
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
            lastVisibleDocs = visibleDocs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
            lastExpiredKeys = expiredKeysKey;
            lastDeletedKeys = deletedKeysKey;
            onUpdate({
                messages,
                cursor: visibleDocs[0] ?? docs[0] ?? null,
                carry,
                hasOlder: visibleStart > 0 || snap.docs.length >= queryLimit,
                hasMore: visibleStart > 1 || snap.docs.length >= queryLimit,
                exists: true,
                fromCache: !!snap.metadata?.fromCache,
                expiredKeys: [...expiredKeys],
                deletedKeys: [...deletedKeys],
            });
        },
        onError
    );
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
        const cursorMs = getCursorMillis(cursor);
        const usingSnapshotCursor = cursorMs == null;
        const q = usingSnapshotCursor
            ? query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), endAt(cursor), limitToLast(queryLimit + 1))
            : query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), endBefore(Timestamp.fromMillis(cursorMs)), limitToLast(queryLimit));
        const snap = await getDocsFromServer(q);
        const olderDocs = (usingSnapshotCursor ? snap.docs.slice(0, -1) : snap.docs).filter((docSnap) => !messageDataExpired(docSnap.data()));
        const entries = trimEntriesToVisiblePage(await decryptDocEntries(olderDocs, userChatPK, userPrivKey, peerChatPK), pageSize);
        const visibleDocs = entries.map((entry) => entry.doc);
        const visibleStart = docIndexById(olderDocs, visibleDocs[0]?.id);
        const filledQuery = usingSnapshotCursor ? snap.docs.length >= queryLimit + 1 : snap.docs.length >= queryLimit;
        const messages = entries.map((entry) => entry.message);

        return {
            messages,
            cursor: visibleDocs[0] ?? olderDocs[0] ?? null,
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
