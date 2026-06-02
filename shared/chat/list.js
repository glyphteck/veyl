import { collection, doc, getDocFromServer, getDocsFromServer, limit, onSnapshot, orderBy, query, startAfter } from 'firebase/firestore';
import { CHAT_LIST_PAGE_SIZE, CHAT_LIST_SNAPSHOT_COALESCE_MS } from '../config.js';
import { canShowMsg, canStoreMsg, isControlMsg } from './messages.js';
import { openOwnChatEntry, ownChatEntryId } from './entry.js';
import { inboxQuery, processInbox } from './inbox.js';
import { isChatUnseenForUser } from './chats.js';
import { timestampKey, timestampMs } from '../utils/time.js';
import { positiveInt } from '../utils/number.js';

function chatDocDataEqual(a, b) {
    if (a === b) {
        return true;
    }
    return !!a && !!b && timestampKey(a.ts ?? null) === timestampKey(b.ts ?? null) && a.body === b.body;
}

function chatEntriesQuery(db, uid, count, cursor) {
    const clauses = [collection(db, 'users', uid, 'chats'), orderBy('ts', 'desc')];
    if (cursor) {
        clauses.push(startAfter(cursor));
    }
    clauses.push(limit(positiveInt(count, CHAT_LIST_PAGE_SIZE)));
    return query(...clauses);
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

async function readEntries(userChatPK, userPrivKey, docs, cache, options = {}) {
    if (cache?.size && options?.prune !== false) {
        const keep = new Set(docs.map((docSnap) => docSnap.id));
        for (const id of cache.keys()) {
            if (!keep.has(id)) {
                cache.delete(id);
            }
        }
    }

    const chats = await Promise.all((docs || []).map((docSnap) => chatFromEntry(docSnap, userChatPK, userPrivKey, cache)));
    return chats.filter(Boolean).sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
}

export function listenToChats(db, uid, userChatPK, userPrivKey, onUpdate, onError, options = {}) {
    const pageSize = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_LIST_PAGE_SIZE);
    const cache = new Map();
    let run = 0;
    let snapshotVersion = 0;
    let timer = null;
    let pending = null;
    let processing = false;
    let inboxProcessing = false;
    let inboxQueued = false;
    let closed = false;
    let processedFirst = false;
    let latestChats = [];
    let latestMeta = {
        cursor: null,
        hasMore: false,
    };
    const optimisticChats = new Map();

    const mergedChats = (chats) => {
        const nextById = new Map((chats || []).filter(Boolean).map((chat) => [chat.id, chat]));
        for (const chat of chats || []) {
            const optimistic = optimisticChats.get(chat?.id);
            if (!optimistic) {
                continue;
            }
            if ((chat?.ts || 0) >= (optimistic?.ts || 0)) {
                optimisticChats.delete(chat.id);
            } else {
                nextById.set(chat.id, optimistic);
            }
        }
        for (const [id, chat] of optimisticChats.entries()) {
            if (!nextById.has(id)) {
                nextById.set(id, chat);
            }
        }
        return [...nextById.values()].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
    };

    const publishPingChat = (chat) => {
        if (closed || !chat?.id) {
            return;
        }
        const existing = optimisticChats.get(chat.id) || latestChats.find((current) => current?.id === chat.id);
        if (existing && (existing?.ts || 0) > (chat?.ts || 0)) {
            return;
        }
        optimisticChats.set(chat.id, chat);
        latestChats = mergedChats(latestChats);
        onUpdate(latestChats, latestChats.map((item) => item.peerChatPK).filter(Boolean), {
            cursor: latestMeta.cursor,
            hasMore: latestMeta.hasMore,
        });
    };

    const processPending = () => {
        timer = null;
        if (closed || processing || !pending) {
            return;
        }

        const current = pending;
        pending = null;
        processing = true;
        const runId = ++run;
        void Promise.resolve(current)
            .then(async (snapshot) => ({
                snapshot,
                chats: await readEntries(userChatPK, userPrivKey, snapshot.docs, cache),
            }))
            .then(({ snapshot, chats }) => {
                if (!closed && runId === run) {
                    processedFirst = true;
                    latestChats = mergedChats(chats);
                    latestMeta = {
                        cursor: snapshot.cursor,
                        hasMore: snapshot.hasMore,
                    };
                    onUpdate(latestChats, latestChats.map((chat) => chat.peerChatPK).filter(Boolean), {
                        cursor: snapshot.cursor,
                        hasMore: snapshot.hasMore,
                    });
                }
            })
            .catch((error) => {
                if (!closed && runId === run) {
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

    const processQueuedInbox = () => {
        if (closed || inboxProcessing || !inboxQueued) {
            return;
        }
        inboxQueued = false;
        inboxProcessing = true;
        void processInbox(db, uid, userChatPK, userPrivKey, {
            currentChats: latestChats,
            onPingChat: publishPingChat,
        })
            .catch((error) => {
                if (!closed) {
                    onError?.(error);
                }
            })
            .finally(() => {
                inboxProcessing = false;
                if (inboxQueued && !closed) {
                    setTimeout(processQueuedInbox, 0);
                }
            });
    };

    const queueInboxProcess = () => {
        if (closed) {
            return;
        }
        inboxQueued = true;
        if (!inboxProcessing) {
            setTimeout(processQueuedInbox, 0);
        }
    };

    const schedule = (delayMs) => {
        if (timer || processing || closed) {
            return;
        }
        timer = setTimeout(processPending, delayMs);
    };

    const unsub = onSnapshot(
        chatEntriesQuery(db, uid, pageSize),
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
    const inboxUnsub = onSnapshot(
        inboxQuery(db, uid),
        (snap) => {
            if (snap.metadata?.hasPendingWrites || snap.empty) {
                return;
            }
            queueInboxProcess();
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
        inboxQueued = false;
        unsub?.();
        inboxUnsub?.();
    };
}

export async function loadMoreChats(db, uid, userChatPK, userPrivKey, cursor, pageSize) {
    if (!db || !uid || !userChatPK || !userPrivKey || !cursor) {
        return {
            chats: [],
            peers: [],
            cursor: null,
            hasMore: false,
        };
    }

    const count = positiveInt(pageSize, CHAT_LIST_PAGE_SIZE);
    const snap = await getDocsFromServer(chatEntriesQuery(db, uid, count, cursor));
    const chats = await readEntries(userChatPK, userPrivKey, snap.docs, new Map(), { prune: false });
    return {
        chats,
        peers: chats.map((chat) => chat.peerChatPK).filter(Boolean),
        cursor: snap.docs[snap.docs.length - 1] ?? cursor,
        hasMore: snap.docs.length >= count,
    };
}

export async function getChat(db, uid, chatId, userChatPK, userPrivKey) {
    if (!db || !uid || !chatId || !userChatPK || !userPrivKey) {
        return null;
    }
    const entryId = ownChatEntryId(userPrivKey, chatId);
    const snap = await getDocFromServer(doc(db, 'users', uid, 'chats', entryId)).catch(() => null);
    if (!snap?.exists?.()) {
        return null;
    }
    const chat = await chatFromEntry(snap, userChatPK, userPrivKey, new Map());
    return chat?.id === chatId ? chat : null;
}

async function decryptChatEntry(docSnap, userChatPK, userPrivKey) {
    const data = docSnap.data();
    const entry = await openOwnChatEntry(userPrivKey, docSnap.id, data?.body);
    const lastMsg = normalizeChatLastMsg({ ts: data?.ts ?? null, ttl: entry?.lastMsg?.ttl ?? null }, entry?.lastMsg);
    const visibleLastMsg = lastMsg && canShowMsg(lastMsg) && !isControlMsg(lastMsg) ? lastMsg : null;
    const ts = timestampMs(data?.ts, null) ?? timestampMs(visibleLastMsg?.ts, null) ?? 0;
    const readMs = timestampMs(entry.readMs, null);
    if (!ts) {
        return null;
    }
    return {
        id: entry.chatId,
        entryId: docSnap.id,
        peerChatPK: entry.peerChatPK,
        peerUid: entry.peerUid || null,
        actors: entry.actors || {},
        settings: entry.settings,
        saved: entry.saved || null,
        readMs,
        lastMsg: visibleLastMsg,
        ts,
        unseen: visibleLastMsg ? isChatUnseenForUser({ lastMsg: visibleLastMsg, readMs }, userChatPK) : false,
    };
}

async function chatFromEntry(docSnap, userChatPK, userPrivKey, cache) {
    const data = docSnap.data();
    const cached = cache?.get?.(docSnap.id);
    if (cached && chatDocDataEqual(cached.data, data)) {
        return cached.chat;
    }

    const chat = await decryptChatEntry(docSnap, userChatPK, userPrivKey).catch(() => null);
    cache?.set?.(docSnap.id, { data, chat });
    return chat;
}
