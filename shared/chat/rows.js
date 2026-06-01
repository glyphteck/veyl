import { collection, query, where, orderBy, onSnapshot, doc, getDocsFromServer, getDocFromServer, limit, startAfter } from 'firebase/firestore';
import { CHAT_LIST_PAGE_SIZE, CHAT_LIST_SNAPSHOT_COALESCE_MS } from '../config.js';
import { sameArray, uniqueValues } from '../utils/array.js';
import { openMsg } from '../crypto/chat.js';
import { canShowMsg, canStoreMsg, isControlMsg } from './messages.js';
import { openChatSettingsForPair } from './settings.js';
import { getChatPeerPK } from './ids.js';
import { getCachedPair } from './pairs.js';
import { timestampKey, timestampMs } from '../utils/time.js';
import { sameBytes, sameHead } from './equal.js';
import { positiveInt } from '../utils/number.js';

function envelopesEqual(a, b) {
    if (a == null || b == null) {
        return a == null && b == null;
    }
    return sameHead(a?.head, b?.head) && sameBytes(a?.body, b?.body) && timestampKey(a?.ttl ?? null) === timestampKey(b?.ttl ?? null);
}

function chatDocDataEqual(a, b) {
    if (a === b) {
        return true;
    }
    return (
        !!a &&
        !!b &&
        a.deleting === b.deleting &&
        sameArray(a.participants, b.participants) &&
        timestampKey(a.ts ?? null) === timestampKey(b.ts ?? null) &&
        envelopesEqual(a.lastMsg, b.lastMsg) &&
        envelopesEqual(a.settings, b.settings)
    );
}

function chatListQuery(db, userChatPK, count, cursor) {
    const base = [where('participants', 'array-contains', userChatPK), orderBy('ts', 'desc')];
    if (cursor) {
        base.push(startAfter(cursor));
    }
    base.push(limit(positiveInt(count, CHAT_LIST_PAGE_SIZE)));
    return query(collection(db, 'chats'), ...base);
}

function normalizeChatLastMsg(msgData, message) {
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

export function isChatUnseenForUser(chatData, userChatPK) {
    const last = chatData?.lastMsg;
    if (!last?.ts || !canShowMsg(last)) return false;
    const from = last?.from || last?.s || last?.head?.from;
    if (from && from === userChatPK) return false;
    return !!from;
}

export function listenToChats(db, userChatPK, userPrivKey, onUpdate, onError, options = {}) {
    const pageSize = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_LIST_PAGE_SIZE);
    const cache = new Map();
    let run = 0;
    let snapshotVersion = 0;
    let timer = null;
    let pending = null;
    let processing = false;
    let closed = false;
    let processedFirst = false;

    const processPending = () => {
        timer = null;
        if (closed || processing || !pending) {
            return;
        }

        const current = pending;
        pending = null;
        processing = true;
        const runId = ++run;
        void handleChats(db, current.docs, userChatPK, userPrivKey, cache)
            .then(({ chats, peers, deletingChatIds }) => {
                if (!closed && runId === run && current.version === snapshotVersion) {
                    processedFirst = true;
                    onUpdate(chats, peers, {
                        deletingChatIds,
                        cursor: current.cursor,
                        hasMore: current.hasMore,
                    });
                }
            })
            .catch((error) => {
                if (!closed && runId === run && current.version === snapshotVersion) {
                    onError?.(error);
                }
            })
            .finally(() => {
                processing = false;
                if (pending && !closed) {
                    timer = setTimeout(processPending, CHAT_LIST_SNAPSHOT_COALESCE_MS);
                }
            });
    };

    const schedule = (delayMs) => {
        if (timer || processing || closed) {
            return;
        }
        timer = setTimeout(processPending, delayMs);
    };

    const unsub = onSnapshot(
        chatListQuery(db, userChatPK, pageSize),
        (snap) => {
            if (snap.metadata?.hasPendingWrites) {
                return;
            }
            pending = {
                version: ++snapshotVersion,
                docs: snap.docs,
                cursor: snap.docs[snap.docs.length - 1] ?? null,
                hasMore: snap.docs.length >= pageSize,
            };
            schedule(processedFirst ? CHAT_LIST_SNAPSHOT_COALESCE_MS : 0);
        },
        onError
    );
    return () => {
        closed = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        pending = null;
        unsub?.();
    };
}

export async function loadMoreChats(db, userChatPK, userPrivKey, cursor, pageSize) {
    if (!db || !userChatPK || !userPrivKey || !cursor) {
        return {
            chats: [],
            peers: [],
            deletingChatIds: [],
            cursor: null,
            hasMore: false,
        };
    }

    const count = positiveInt(pageSize, CHAT_LIST_PAGE_SIZE);
    const snap = await getDocsFromServer(chatListQuery(db, userChatPK, count, cursor));
    const result = await handleChats(db, snap.docs, userChatPK, userPrivKey, new Map(), { prune: false });
    return {
        ...result,
        cursor: snap.docs[snap.docs.length - 1] ?? cursor,
        hasMore: snap.docs.length >= count,
    };
}

export async function getChatRow(db, chatId, userChatPK, userPrivKey) {
    if (!db || !chatId || !userChatPK || !userPrivKey) {
        return null;
    }
    const snap = await getDocFromServer(doc(db, 'chats', chatId)).catch(() => null);
    if (!snap?.exists?.()) {
        return null;
    }
    return decryptChatDoc(snap, userChatPK, userPrivKey);
}

async function decryptChatDoc(docSnap, userChatPK, userPrivKey) {
    const data = docSnap.data();
    if (data?.deleting) {
        return null;
    }
    const participants = Array.isArray(data?.participants) ? data.participants.filter(Boolean) : [];
    const peerPK = getChatPeerPK({ id: docSnap.id, participants }, userChatPK);
    if (!peerPK) {
        return null;
    }
    const pair = await getCachedPair(userChatPK, userPrivKey, peerPK);
    const settings = await openChatSettingsForPair(pair, data?.settings);
    if (!settings) {
        return null;
    }
    const lastMsgData = data?.lastMsg;
    const lastMsg =
        lastMsgData && peerPK
            ? await openMsg(pair, lastMsgData)
                  .then((message) => normalizeChatLastMsg({ ...lastMsgData, ts: data?.ts ?? null }, message))
                  .catch(() => null)
            : null;
    const visibleLastMsg = lastMsg && canShowMsg(lastMsg) && !isControlMsg(lastMsg) ? lastMsg : null;
    const ts = timestampMs(data?.ts, null);
    if (!ts) {
        return null;
    }
    const unseen = visibleLastMsg ? isChatUnseenForUser({ lastMsg: visibleLastMsg }, userChatPK) : false;
    return { id: docSnap.id, participants, settings, lastMsg: visibleLastMsg, ts, unseen };
}

async function chatRowFromDoc(db, docSnap, userChatPK, userPrivKey, cache) {
    const data = docSnap.data();
    const cached = cache?.get?.(docSnap.id);
    if (cached && chatDocDataEqual(cached.data, data)) {
        return cached.chat;
    }

    const chat = await decryptChatDoc(docSnap, userChatPK, userPrivKey);
    cache?.set?.(docSnap.id, { data, chat });
    return chat;
}

async function handleChats(db, docs, userChatPK, userPrivKey, cache, options = {}) {
    if (cache?.size && options?.prune !== false) {
        const keep = new Set(docs.map((docSnap) => docSnap.id));
        for (const id of cache.keys()) {
            if (!keep.has(id)) {
                cache.delete(id);
            }
        }
    }

    const rowDocs = [];
    const deletingChatIds = [];
    for (const docSnap of docs || []) {
        if (docSnap.data()?.deleting === true) {
            deletingChatIds.push(docSnap.id);
            cache?.set?.(docSnap.id, { data: docSnap.data(), chat: null });
            continue;
        }
        rowDocs.push(docSnap);
    }

    const chats = await Promise.all(
        rowDocs.map((docSnap) => chatRowFromDoc(db, docSnap, userChatPK, userPrivKey, cache))
    );
    const readyChats = chats.filter(Boolean).sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
    const peers = uniqueValues(readyChats.map((chat) => getChatPeerPK(chat, userChatPK)));
    return { chats: readyChats, peers, deletingChatIds };
}
