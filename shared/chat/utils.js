import { collection, query, where, orderBy, onSnapshot, doc, serverTimestamp, updateDoc, writeBatch, endAt, endBefore, getDocs, getDocsFromServer, getDoc, limitToLast, limit, deleteField, Timestamp } from 'firebase/firestore';
import { closeChatPair, getChatId, hasMsgData, openChatPair, openMsg, resealMsgBody, sealMsg } from '../crypto/chat.js';
import { orderChatKeys } from '../crypto/pair.js';
import { putAttachment, putFile, putImg, putMp3, putMp4, readMsgFile } from './media.js';
import { canShowMsg, canStoreMsg, makeReadReceipt } from './messages.js';
import { getMessageKey, makeCid } from './state.js';

export const MSG_BATCH_SIZE = 40;

// Cache pair roots so mobile doesn't redo static DH + HKDF for every decrypt.
const pairCache = new Map();
const MAX_PAIR_CACHE = 256;

export function clearChatPairCache() {
    for (const pair of pairCache.values()) {
        closeChatPair(pair);
    }
    pairCache.clear();
}

export function getPeerChatPKFromChatId(chatId, myChatPK) {
    const parts = String(chatId ?? '').split('_');
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    return a === myChatPK ? b : a;
}

export function filterChatMessages(messages, chatPK, peerChatPK) {
    const allowed = new Set([chatPK, peerChatPK].filter(Boolean));
    if (!allowed.size) {
        return messages || [];
    }

    return (messages || []).filter((message) => {
        const sender = typeof message?.s === 'string' && message.s ? message.s : typeof message?.from === 'string' ? message.from : '';
        return !sender || allowed.has(sender);
    });
}

export function getChatPeerPK(chatItem, chatPK) {
    return chatItem?.participants?.find?.((participant) => participant && participant !== chatPK) ?? getPeerChatPKFromChatId(chatItem?.id, chatPK);
}

export function getChatRowLastMsgKey(chatItem) {
    const lastMsg = chatItem?.lastMsg;
    if (!lastMsg || lastMsg.pending || lastMsg.failed || String(lastMsg?.id || '').startsWith('local:')) {
        return null;
    }
    return getMessageKey(lastMsg);
}

function getOwnChatPKFromChatId(chatId, peerChatPK) {
    const parts = String(chatId ?? '').split('_');
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    if (a === peerChatPK) return b;
    if (b === peerChatPK) return a;
    return null;
}

function getChatPairKey(chatPK, peerChatPK) {
    if (!chatPK || !peerChatPK) return null;
    return orderChatKeys(chatPK, peerChatPK).join('|');
}

function toMillis(ts, fallback = 0) {
    if (typeof ts?.toMillis === 'function') {
        const ms = ts.toMillis();
        return Number.isFinite(ms) ? ms : fallback;
    }
    if (ts instanceof Date) {
        const ms = ts.getTime();
        return Number.isFinite(ms) ? ms : fallback;
    }
    if (Number.isFinite(ts)) {
        return ts;
    }
    return fallback;
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
    };
    return canStoreMsg(normalized) ? normalized : null;
}

async function getCachedPair(chatPK, chatPrivKey, peerChatPK) {
    const key = getChatPairKey(chatPK, peerChatPK);
    if (!key) {
        return openChatPair(chatPK, chatPrivKey, peerChatPK);
    }

    const cached = pairCache.get(key);
    if (cached) return cached;
    const pair = await openChatPair(chatPK, chatPrivKey, peerChatPK);
    pairCache.set(key, pair);
    if (pairCache.size > MAX_PAIR_CACHE) {
        const firstKey = pairCache.keys().next().value;
        if (firstKey) {
            closeChatPair(pairCache.get(firstKey));
            pairCache.delete(firstKey);
        }
    }
    return pair;
}

async function decryptDocs(docs, userChatPK, userPrivKey, peerChatPK) {
    const messages = await Promise.all(
        docs.map(async (docSnap) => {
            const dec = await decryptMsg(docSnap.data(), userChatPK, userPrivKey, peerChatPK);
            return dec ? { ...dec, id: docSnap.id } : null;
        })
    );
    return messages.filter(Boolean);
}

export function isChatUnseenForUser(chatData, userChatPK) {
    const last = chatData?.lastMsg;
    if (!last?.ts || !canShowMsg(last)) return false;
    const from = last?.from || last?.s || last?.head?.from;
    if (from && from === userChatPK) return false;
    return !!from;
}

export async function sendMsg(db, senderPubkey, senderPrivkey, receiverChatPK, message, options = {}) {
    if (!senderPrivkey || !senderPubkey) {
        throw new Error('vault locked');
    }
    const updateLastMsg = options?.updateLastMsg !== false;
    const sortedKeys = orderChatKeys(senderPubkey, receiverChatPK);
    const chatId = getChatId(senderPubkey, receiverChatPK);
    const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK);
    const { head, body } = await sealMsg(pair, message);
    const chatRef = doc(db, 'chats', chatId);
    const msgData = {
        head,
        body,
        ts: serverTimestamp(),
    };

    const batch = writeBatch(db);
    const msgRef = doc(collection(chatRef, 'messages'));
    batch.set(msgRef, msgData);
    if (updateLastMsg) {
        batch.set(chatRef, { participants: sortedKeys, lastMsg: msgData }, { merge: true });
    }
    await batch.commit();
    return { chatId, msgId: msgRef.id, cid: head.cid };
}

export async function sendReadReceipt(db, senderPubkey, senderPrivkey, receiverChatPK, target) {
    const receipt = {
        ...makeReadReceipt(target),
        cid: makeCid(),
        s: senderPubkey,
    };
    return sendMsg(db, senderPubkey, senderPrivkey, receiverChatPK, receipt, { updateLastMsg: false });
}

export async function uploadImgMsg(db, storage, senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsg(db, storage, senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'img',
        data,
        meta,
    });
}

export async function uploadMp3Msg(db, storage, senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsg(db, storage, senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'mp3',
        data,
        meta,
    });
}

export async function uploadMp4Msg(db, storage, senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsg(db, storage, senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'mp4',
        data,
        meta,
    });
}

export async function uploadFileMsg(db, storage, senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsg(db, storage, senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'file',
        data,
        meta,
    });
}

export async function uploadAttachmentMsg(db, storage, senderPubkey, senderPrivkey, receiverChatPK, attachment = {}) {
    if (!storage) {
        throw new Error('storage required');
    }
    if (!senderPrivkey || !senderPubkey) {
        throw new Error('vault locked');
    }

    const nextCid = typeof attachment?.cid === 'string' ? attachment.cid.trim() : '';
    if (!nextCid) {
        throw new Error('message cid required');
    }

    const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK);
    const type = typeof attachment?.type === 'string' && attachment.type ? attachment.type : 'file';
    const data = attachment?.data;
    const meta = attachment?.meta || {};

    switch (type) {
        case 'img':
            return putImg(storage, pair, nextCid, data, meta);
        case 'mp3':
            return putMp3(storage, pair, nextCid, data, meta);
        case 'mp4':
            return putMp4(storage, pair, nextCid, data, meta);
        case 'file':
            return putFile(storage, pair, nextCid, data, meta);
        default:
            return putAttachment(storage, pair, nextCid, type, data, meta);
    }
}

export async function updateMsg(db, chatId, msgId, senderPrivkey, receiverChatPK, newMessage, options = {}) {
    if (!senderPrivkey) throw new Error('vault locked');
    const senderPubkey = getOwnChatPKFromChatId(chatId, receiverChatPK);
    const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK);
    const msgRef = doc(db, 'chats', chatId, 'messages', msgId);
    const msgSnap = await getDoc(msgRef);
    if (!msgSnap.exists()) {
        throw new Error('message not found');
    }

    const current = msgSnap.data();
    const body = await resealMsgBody(pair, current.head, newMessage);
    // update only the encrypted body, keeping the authenticated header stable
    await updateDoc(msgRef, { body });

    // Keep the chat preview in sync when the edited message is still the latest.
    // Do not touch lastMsg.ts or lastMsg.head so edits cannot create false unseen state.
    const syncLastMsg = options?.updateLastMsg !== false;
    const nextCid = syncLastMsg && typeof newMessage?.cid === 'string' ? newMessage.cid : '';
    if (nextCid) {
        try {
            const chatRef = doc(db, 'chats', chatId);
            const chatSnap = await getDoc(chatRef);
            if (chatSnap.exists() && chatSnap.data()?.lastMsg?.head?.cid === nextCid) {
                await updateDoc(chatRef, { 'lastMsg.body': body });
            }
        } catch (error) {
            console.warn('could not sync chat preview after message update', error);
        }
    }
}

export async function deleteMsg(db, chatId, msgId) {
    if (!db || !chatId || !msgId) {
        return false;
    }

    const chatRef = doc(db, 'chats', chatId);
    const msgRef = doc(db, 'chats', chatId, 'messages', msgId);
    const [chatSnap, msgSnap] = await Promise.all([getDoc(chatRef), getDoc(msgRef)]);

    if (!msgSnap.exists()) {
        return false;
    }

    const current = msgSnap.data();
    const currentCid = current?.head?.cid ?? null;
    const lastCid = chatSnap.exists() ? (chatSnap.data()?.lastMsg?.head?.cid ?? null) : null;
    const syncLastMsg = !!chatSnap.exists() && !!currentCid && currentCid === lastCid;
    let nextLastMsg = null;

    if (syncLastMsg) {
        const latestSnap = await getDocs(query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'desc'), limit(2)));
        const previousDoc = latestSnap.docs.find((docSnap) => docSnap.id !== msgId) ?? null;
        nextLastMsg = previousDoc?.data() ?? null;
    }

    const batch = writeBatch(db);
    // Stored attachment blobs can be shared by reference, so deleting a message
    // must not delete the underlying Firebase Storage object.
    batch.delete(msgRef);

    if (syncLastMsg) {
        if (nextLastMsg) {
            batch.update(chatRef, { lastMsg: nextLastMsg });
        } else {
            batch.update(chatRef, { lastMsg: deleteField() });
        }
    }

    await batch.commit();
    return true;
}

export async function decryptMsg(msgData, userChatPK, userPrivKey, peerChatPK) {
    if (!hasMsgData(msgData) || !userChatPK || !userPrivKey || !peerChatPK) {
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

export async function readMsgMedia(storage, userChatPK, userPrivKey, peerChatPK, msg) {
    return readMsgAttachment(storage, userChatPK, userPrivKey, peerChatPK, msg);
}

export async function readMsgAttachment(storage, userChatPK, userPrivKey, peerChatPK, msg) {
    if (!storage) {
        throw new Error('storage required');
    }
    if (!userChatPK || !userPrivKey || !peerChatPK || !msg) {
        return null;
    }

    const pair = await getCachedPair(userChatPK, userPrivKey, peerChatPK);
    return readMsgFile(storage, pair, msg);
}

export function listenToChats(db, userChatPK, userPrivKey, onUpdate, onError) {
    const q = query(collection(db, 'chats'), where('participants', 'array-contains', userChatPK));
    return onSnapshot(q, (snap) => handleChats(db, snap.docs, userChatPK, userPrivKey, onUpdate), onError);
}

async function readLatestChatMessageData(db, chatId) {
    if (!db || !chatId) {
        return null;
    }

    const latestSnap = await getDocs(query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'desc'), limit(1)));
    return latestSnap.docs[0]?.data() ?? null;
}

async function handleChats(db, docs, userChatPK, userPrivKey, onUpdate) {
    const chats = await Promise.all(
        docs.map(async (docSnap) => {
            const data = docSnap.data();
            if (data?.deleting) {
                return null;
            }
            const participants = Array.isArray(data?.participants) ? data.participants.filter(Boolean) : [];
            const peerPK = participants.find((pk) => pk !== userChatPK) ?? getPeerChatPKFromChatId(docSnap.id, userChatPK);
            const lastMsgData = data?.lastMsg || (await readLatestChatMessageData(db, docSnap.id));
            if (!lastMsgData) {
                return null;
            }
            const lastMsg = lastMsgData && peerPK ? await decryptMsg(lastMsgData, userChatPK, userPrivKey, peerPK) : null;
            const lastMsgTime = toMillis(lastMsgData?.ts);
            const unseen = isChatUnseenForUser({ lastMsg }, userChatPK);
            return { id: docSnap.id, participants, lastMsg, lastMsgTime, unseen };
        })
    );
    const readyChats = chats.filter(Boolean).sort((a, b) => (b?.lastMsgTime || 0) - (a?.lastMsgTime || 0));
    const peers = [...new Set(readyChats.map((chat) => chat?.participants?.find((pk) => pk && pk !== userChatPK)).filter(Boolean))];
    onUpdate(readyChats, peers);
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
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), limitToLast(pageSize * 2 + 2));

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

            const changeTypeById = new Map(snap.docChanges().map((change) => [change.doc.id, change.type]));
            const docs = snap.docs.filter((docSnap) => {
                if (!docSnap.metadata.hasPendingWrites) {
                    return true;
                }

                // Keep edited messages visible for the local sender while their
                // body update is pending. We still hide brand-new pending docs so
                // optimistic local sends remain owned by localByChat until acked.
                return changeTypeById.get(docSnap.id) === 'modified';
            });
            const visibleStart = Math.max(docs.length - pageSize * 2, 0);
            const visibleDocs = docs.slice(visibleStart);
            const carry = visibleStart > 0 ? docs[visibleStart - 1] : null;
            const messages = await decryptDocs(visibleDocs, userChatPK, userPrivKey, peerChatPK);
            onUpdate({
                messages,
                cursor: visibleDocs[0] ?? null,
                carry,
                hasOlder: !!carry,
                hasMore: visibleStart > 1,
                exists: true,
                fromCache: !!snap.metadata?.fromCache,
            });
        },
        onError
    );
}

export function listenToMsgDeletes(db, chatId, onUpdate, onError) {
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'));

    return onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snap) => {
            if (snap.metadata?.fromCache) {
                return;
            }

            const removed = snap
                .docChanges()
                .filter((change) => change.type === 'removed' && !change.doc.metadata.hasPendingWrites)
                .map((change) => change.doc.id)
                .filter(Boolean);

            if (removed.length) {
                onUpdate(removed);
            }
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
        const cursorMs = getCursorMillis(cursor);
        const usingSnapshotCursor = cursorMs == null;
        const q = usingSnapshotCursor
            ? query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), endAt(cursor), limitToLast(pageSize * 2 + 2))
            : query(collection(db, 'chats', chatId, 'messages'), orderBy('ts', 'asc'), endBefore(Timestamp.fromMillis(cursorMs)), limitToLast(pageSize * 2 + 1));
        const snap = await getDocsFromServer(q);
        const olderDocs = usingSnapshotCursor ? snap.docs.slice(0, -1) : snap.docs;
        const visibleStart = Math.max(olderDocs.length - pageSize * 2, 0);
        const visibleDocs = olderDocs.slice(visibleStart);
        const messages = await decryptDocs(visibleDocs, userChatPK, userPrivKey, peerChatPK);

        return {
            messages,
            cursor: visibleDocs[0] ?? null,
            hasMore: visibleStart > 0,
        };
    } catch {
        return {
            messages: [],
            cursor: null,
            hasMore: false,
        };
    }
}
