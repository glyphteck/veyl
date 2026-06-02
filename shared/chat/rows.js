import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit, onSnapshot, orderBy, query, setDoc, startAfter, Timestamp, where } from 'firebase/firestore';
import { CHAT_LIST_PAGE_SIZE, CHAT_LIST_SNAPSHOT_COALESCE_MS } from '../config.js';
import { canShowMsg, canStoreMsg, isControlMsg } from './messages.js';
import { makeOwnChatEntry, openChatWake, openOwnChatEntry, ownChatEntryId, sealOwnChatEntry } from './entries.js';
import { decryptMsg } from './messages/query.js';
import { timestampKey, timestampMs } from '../utils/time.js';
import { positiveInt } from '../utils/number.js';
import { cleanText } from '../utils/text.js';

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

function chatInboxQuery(db, uid) {
    return query(collection(db, 'users', uid, 'chatInbox'), orderBy('ts', 'desc'), limit(50));
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
    const from = last?.from || last?.s;
    if (from && from === userChatPK) return false;
    return !!from;
}

async function readEntryRows(db, uid, userChatPK, userPrivKey, docs, cache, options = {}) {
    if (cache?.size && options?.prune !== false) {
        const keep = new Set(docs.map((docSnap) => docSnap.id));
        for (const id of cache.keys()) {
            if (!keep.has(id)) {
                cache.delete(id);
            }
        }
    }

    const rows = await Promise.all((docs || []).map((docSnap) => chatRowFromEntry(db, uid, docSnap, userChatPK, userPrivKey, cache)));
    return rows.filter(Boolean).sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
}

async function readExistingEntry(db, uid, userPrivKey, entryId) {
    const snap = await getDocFromServer(doc(db, 'users', uid, 'chats', entryId)).catch(() => null);
    if (!snap?.exists?.()) {
        return null;
    }
    return openOwnChatEntry(userPrivKey, entryId, snap.data()?.body).catch(() => null);
}

function wakeOrderTimestamp(wake, lastMsg, fallbackMs) {
    const ms = timestampMs(lastMsg?.ts, null) ?? timestampMs(wake?.payload?.ts, null) ?? fallbackMs;
    return Number.isFinite(ms) ? Timestamp.fromMillis(ms) : Timestamp.fromMillis(Date.now());
}

async function writeEntryForWake(db, uid, userChatPK, userPrivKey, wakeResult, options = {}) {
    const chatId = wakeResult?.pair?.chatId;
    if (!chatId || !cleanText(wakeResult?.payload?.actorPK) || !cleanText(wakeResult?.payload?.senderChatPK)) {
        return false;
    }

    const entryId = ownChatEntryId(userPrivKey, chatId);
    const entryRef = doc(db, 'users', uid, 'chats', entryId);
    const existing = options.existing || await readExistingEntry(db, uid, userPrivKey, entryId);
    const peerUid = options.peerUid || await resolveWakePeerUid(db, wakeResult.payload);
    const nextActors = options.actors || {
        ...(existing?.actors || {}),
        [wakeResult.pair.chatPK]: wakeResult.pair.actor.publicKey,
        [wakeResult.payload.senderChatPK]: wakeResult.payload.actorPK,
    };
    const wakeLastMsg = options.lastMsg || await readWakeLastMsg(db, userChatPK, userPrivKey, wakeResult, nextActors);
    const entry = makeOwnChatEntry(wakeResult.pair, {
        peerUid: peerUid || existing?.peerUid,
        peerActorPK: wakeResult.payload.actorPK || existing?.actors?.[wakeResult.payload.senderChatPK],
        actors: nextActors,
        settings: existing?.settings,
        lastMsg: wakeLastMsg || existing?.lastMsg,
    });
    const body = await sealOwnChatEntry(userPrivKey, entryId, entry);
    await setDoc(entryRef, {
        body,
        ts: options.ts || wakeOrderTimestamp(wakeResult, wakeLastMsg, Date.now()),
    }, { merge: true });
    return true;
}

function wakeSortMs(wakeDoc, wake) {
    const payloadMs = Number(wake?.payload?.ts);
    if (Number.isFinite(payloadMs)) {
        return payloadMs;
    }
    return timestampMs(wakeDoc?.data?.()?.ts, 0) ?? 0;
}

function wakeActors(wake, existing) {
    return {
        ...(existing?.actors || {}),
        [wake.pair.chatPK]: wake.pair.actor.publicKey,
        [wake.payload.senderChatPK]: wake.payload.actorPK,
    };
}

function rowFromWake(wake, entryId, existing, lastMsg, userChatPK, ms) {
    const ts = timestampMs(lastMsg?.ts, null) ?? timestampMs(existing?.lastMsg?.ts, null) ?? ms ?? timestampMs(existing?.ts, null) ?? 0;
    if (!ts) {
        return null;
    }
    const visibleLastMsg = lastMsg || existing?.lastMsg || null;
    return {
        id: wake.pair.chatId,
        entryId,
        peerChatPK: wake.payload.senderChatPK,
        peerUid: existing?.peerUid || cleanText(wake.payload.senderUid) || null,
        actors: wakeActors(wake, existing),
        settings: existing?.settings,
        lastMsg: visibleLastMsg,
        ts,
        unseen: visibleLastMsg ? isChatUnseenForUser({ lastMsg: visibleLastMsg }, userChatPK) : false,
    };
}

async function resolveWakePeerUid(db, payload) {
    const senderChatPK = cleanText(payload?.senderChatPK);
    const claimedUid = cleanText(payload?.senderUid);
    if (!db || !senderChatPK) {
        return null;
    }
    if (claimedUid) {
        const snap = await getDocFromServer(doc(db, 'profiles', claimedUid)).catch(() => null);
        if (cleanText(snap?.data?.()?.chatPK) !== senderChatPK) {
            throw new Error('wake sender uid mismatch');
        }
        return claimedUid;
    }
    const snap = await getDocsFromServer(query(collection(db, 'profiles'), where('chatPK', '==', senderChatPK), limit(1))).catch(() => null);
    return snap?.docs?.[0]?.id || null;
}

async function readWakeLastMsg(db, userChatPK, userPrivKey, wakeResult, actors) {
    const chatId = wakeResult?.pair?.chatId;
    const messageId = cleanText(wakeResult?.payload?.messageId);
    const peerChatPK = cleanText(wakeResult?.payload?.senderChatPK);
    if (!db || !chatId || !messageId || !userChatPK || !userPrivKey || !peerChatPK) {
        return null;
    }
    const snap = await getDocFromServer(doc(db, 'chats', chatId, 'messages', messageId)).catch(() => null);
    if (!snap?.exists?.()) {
        return null;
    }
    const data = snap.data();
    const message = await decryptMsg(data, userChatPK, userPrivKey, peerChatPK, { actors }).catch(() => null);
    const lastMsg = normalizeChatLastMsg(data, message ? { ...message, id: snap.id } : null);
    return lastMsg && canShowMsg(lastMsg) && !isControlMsg(lastMsg) ? lastMsg : null;
}

async function processInbox(db, uid, userChatPK, userPrivKey, options = {}) {
    if (!db || !uid || !userChatPK || !userPrivKey) {
        return false;
    }

    const inboxSnap = await getDocsFromServer(chatInboxQuery(db, uid)).catch(() => null);
    if (!inboxSnap?.docs?.length) {
        return false;
    }

    const rowsByChat = new Map((options.currentRows || []).map((row) => [row.id, row]));
    const opened = [];
    const invalidDocs = [];
    for (const wakeDoc of inboxSnap.docs) {
        try {
            const wake = await openChatWake(userChatPK, userPrivKey, wakeDoc.data());
            const chatId = wake?.pair?.chatId;
            if (!chatId) {
                invalidDocs.push(wakeDoc);
                continue;
            }
            opened.push({ wakeDoc, wake, chatId, ms: wakeSortMs(wakeDoc, wake) });
        } catch {
            invalidDocs.push(wakeDoc);
        }
    }

    await Promise.all(invalidDocs.map((wakeDoc) => deleteDoc(wakeDoc.ref).catch(() => {})));

    const latestByChat = new Map();
    for (const item of opened.sort((a, b) => a.ms - b.ms)) {
        const existing = rowsByChat.get(item.chatId) || null;
        const entryId = ownChatEntryId(userPrivKey, item.chatId);
        const actors = wakeActors(item.wake, existing);
        const lastMsg = await readWakeLastMsg(db, userChatPK, userPrivKey, item.wake, actors);
        const row = rowFromWake(item.wake, entryId, existing, lastMsg, userChatPK, item.ms);
        if (row) {
            rowsByChat.set(row.id, row);
            options.onWakeRow?.(row);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const current = latestByChat.get(item.chatId);
        if (!current || item.ms > current.ms) {
            latestByChat.set(item.chatId, {
                ...item,
                docs: [...(current?.docs || []), item.wakeDoc],
                existing,
                actors,
                lastMsg,
            });
            continue;
        }
        current.docs.push(item.wakeDoc);
    }

    const writes = await Promise.all([...latestByChat.values()].map(async (item) => {
        const wrote = await writeEntryForWake(db, uid, userChatPK, userPrivKey, item.wake, {
            existing: item.existing,
            actors: item.actors,
            lastMsg: item.lastMsg,
        });
        if (wrote) {
            await Promise.all(item.docs.map((wakeDoc) => deleteDoc(wakeDoc.ref).catch(() => {})));
        }
        return wrote;
    }));
    return writes.some(Boolean);
}

export function listenToChats(db, uid, userChatPK, userPrivKey, onUpdate, onError, options = {}) {
    const pageSize = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_LIST_PAGE_SIZE);
    const cache = new Map();
    let run = 0;
    let snapshotVersion = 0;
    let timer = null;
    let pending = null;
    let lastSnapshot = null;
    let processing = false;
    let inboxProcessing = false;
    let inboxQueued = false;
    let closed = false;
    let processedFirst = false;
    let latestRows = [];
    let latestMeta = {
        cursor: null,
        hasMore: false,
    };
    const optimisticRows = new Map();

    const mergedRows = (rows) => {
        const nextById = new Map((rows || []).filter(Boolean).map((row) => [row.id, row]));
        for (const row of rows || []) {
            const optimistic = optimisticRows.get(row?.id);
            if (!optimistic) {
                continue;
            }
            if ((row?.ts || 0) >= (optimistic?.ts || 0)) {
                optimisticRows.delete(row.id);
            } else {
                nextById.set(row.id, optimistic);
            }
        }
        for (const [id, row] of optimisticRows.entries()) {
            if (!nextById.has(id)) {
                nextById.set(id, row);
            }
        }
        return [...nextById.values()].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
    };

    const publishWakeRow = (row) => {
        if (closed || !row?.id) {
            return;
        }
        const existing = optimisticRows.get(row.id) || latestRows.find((current) => current?.id === row.id);
        if (existing && (existing?.ts || 0) > (row?.ts || 0)) {
            return;
        }
        optimisticRows.set(row.id, row);
        latestRows = mergedRows(latestRows);
        onUpdate(latestRows, latestRows.map((chat) => chat.peerChatPK).filter(Boolean), {
            deletingChatIds: [],
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
                chats: await readEntryRows(db, uid, userChatPK, userPrivKey, snapshot.docs, cache),
            }))
            .then(({ snapshot, chats }) => {
                if (!closed && runId === run) {
                    processedFirst = true;
                    latestRows = mergedRows(chats);
                    latestMeta = {
                        cursor: snapshot.cursor,
                        hasMore: snapshot.hasMore,
                    };
                    onUpdate(latestRows, latestRows.map((chat) => chat.peerChatPK).filter(Boolean), {
                        deletingChatIds: [],
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
            currentRows: latestRows,
            onWakeRow: publishWakeRow,
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
            lastSnapshot = {
                version: ++snapshotVersion,
                docs: snap.docs,
                cursor: snap.docs[snap.docs.length - 1] ?? null,
                hasMore: snap.docs.length >= pageSize,
            };
            pending = lastSnapshot;
            schedule(processedFirst ? CHAT_LIST_SNAPSHOT_COALESCE_MS : 0);
        },
        onError
    );
    const inboxUnsub = onSnapshot(
        chatInboxQuery(db, uid),
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
            deletingChatIds: [],
            cursor: null,
            hasMore: false,
        };
    }

    const count = positiveInt(pageSize, CHAT_LIST_PAGE_SIZE);
    const snap = await getDocsFromServer(chatEntriesQuery(db, uid, count, cursor));
    const chats = await readEntryRows(db, uid, userChatPK, userPrivKey, snap.docs, new Map(), { prune: false });
    return {
        chats,
        peers: chats.map((chat) => chat.peerChatPK).filter(Boolean),
        deletingChatIds: [],
        cursor: snap.docs[snap.docs.length - 1] ?? cursor,
        hasMore: snap.docs.length >= count,
    };
}

export async function getChatRow(db, uid, chatId, userChatPK, userPrivKey) {
    if (!db || !uid || !chatId || !userChatPK || !userPrivKey) {
        return null;
    }
    const snap = await getDocsFromServer(chatEntriesQuery(db, uid, 100, null)).catch(() => null);
    if (!snap?.docs?.length) {
        return null;
    }
    const rows = await readEntryRows(db, uid, userChatPK, userPrivKey, snap.docs, new Map(), { prune: false });
    return rows.find((row) => row?.id === chatId) ?? null;
}

async function decryptChatEntry(docSnap, userChatPK, userPrivKey) {
    const data = docSnap.data();
    const entry = await openOwnChatEntry(userPrivKey, docSnap.id, data?.body);
    const lastMsg = normalizeChatLastMsg({ ts: data?.ts ?? null, ttl: entry?.lastMsg?.ttl ?? null }, entry?.lastMsg);
    const visibleLastMsg = lastMsg && canShowMsg(lastMsg) && !isControlMsg(lastMsg) ? lastMsg : null;
    const ts = timestampMs(data?.ts, null) ?? timestampMs(visibleLastMsg?.ts, null) ?? 0;
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
        lastMsg: visibleLastMsg,
        ts,
        unseen: visibleLastMsg ? isChatUnseenForUser({ lastMsg: visibleLastMsg }, userChatPK) : false,
    };
}

async function chatRowFromEntry(db, uid, docSnap, userChatPK, userPrivKey, cache) {
    const data = docSnap.data();
    const cached = cache?.get?.(docSnap.id);
    if (cached && chatDocDataEqual(cached.data, data)) {
        return cached.chat;
    }

    const chat = await decryptChatEntry(docSnap, userChatPK, userPrivKey).catch(() => null);
    cache?.set?.(docSnap.id, { data, chat });
    return chat;
}
