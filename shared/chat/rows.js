import { collection, query, where, orderBy, onSnapshot, doc, getDocsFromServer, getDocFromServer, limit, startAfter } from 'firebase/firestore';
import { openMsg } from '../crypto/chat.js';
import { canShowMsg, canStoreMsg, isControlMsg } from './messages.js';
import { openChatSettingsForPair } from './settings.js';
import { getPeerChatPKFromChatId } from './ids.js';
import { getCachedPair } from './pairs.js';
import { toMillis, valueMillis } from './time.js';

function arraysEqual(a, b) {
    if (a === b) {
        return true;
    }
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) {
            return false;
        }
    }
    return true;
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

function headsEqual(a, b) {
    if (a === b) {
        return true;
    }
    return a?.from === b?.from && a?.cid === b?.cid;
}

function envelopesEqual(a, b) {
    if (a == null || b == null) {
        return a == null && b == null;
    }
    return headsEqual(a?.head, b?.head) && bytesEqual(a?.body, b?.body) && valueMillis(a?.ttl ?? null) === valueMillis(b?.ttl ?? null);
}

function chatDocDataEqual(a, b) {
    if (a === b) {
        return true;
    }
    return (
        !!a &&
        !!b &&
        a.deleting === b.deleting &&
        arraysEqual(a.participants, b.participants) &&
        valueMillis(a.ts ?? null) === valueMillis(b.ts ?? null) &&
        envelopesEqual(a.lastMsg, b.lastMsg) &&
        envelopesEqual(a.settings, b.settings)
    );
}

function cleanPositiveInt(value, fallback) {
    const next = Number(value);
    return Number.isFinite(next) && next > 0 ? Math.floor(next) : fallback;
}

function chatListQuery(db, userChatPK, count, cursor) {
    const base = [where('participants', 'array-contains', userChatPK), orderBy('ts', 'desc')];
    if (cursor) {
        base.push(startAfter(cursor));
    }
    base.push(limit(cleanPositiveInt(count, 20)));
    return query(collection(db, 'chats'), ...base);
}

function chatParticipantQuery(db, userChatPK) {
    return query(collection(db, 'chats'), where('participants', 'array-contains', userChatPK));
}

function isIndexUnavailableError(error) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return code.includes('failed-precondition') && message.includes('index');
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
    const pageSize = cleanPositiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, 20);
    const cache = new Map();
    let run = 0;
    let unsub = null;
    let usingFallback = false;

    const listen = (q, fallback = false) =>
        onSnapshot(
            q,
            (snap) => {
                if (snap.metadata?.hasPendingWrites) {
                    return;
                }
                const runId = ++run;
                void handleChats(db, snap.docs, userChatPK, userPrivKey, cache)
                    .then(({ chats, peers, deletingChatIds }) => {
                        if (runId === run) {
                            onUpdate(chats, peers, {
                                deletingChatIds,
                                cursor: fallback ? null : (snap.docs[snap.docs.length - 1] ?? null),
                                hasMore: fallback ? false : snap.docs.length >= pageSize,
                                fallback,
                            });
                        }
                    })
                    .catch((error) => {
                        if (runId === run) {
                            onError?.(error);
                        }
                    });
            },
            (error) => {
                if (!fallback && !usingFallback && isIndexUnavailableError(error)) {
                    usingFallback = true;
                    run += 1;
                    cache.clear();
                    unsub?.();
                    unsub = listen(chatParticipantQuery(db, userChatPK), true);
                    return;
                }
                onError?.(error);
            }
        );

    unsub = listen(chatListQuery(db, userChatPK, pageSize));
    return () => unsub?.();
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

    const count = cleanPositiveInt(pageSize, 20);
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
    const peerPK = participants.find((pk) => pk !== userChatPK) ?? getPeerChatPKFromChatId(docSnap.id, userChatPK);
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
    const ts = toMillis(data?.ts, null);
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
    const peers = [...new Set(readyChats.map((chat) => chat?.participants?.find((pk) => pk && pk !== userChatPK)).filter(Boolean))];
    return { chats: readyChats, peers, deletingChatIds };
}
