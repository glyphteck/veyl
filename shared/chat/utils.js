import { collection, query, where, orderBy, onSnapshot, doc, serverTimestamp, updateDoc, writeBatch, endAt, endBefore, getDocs, getDocsFromServer, getDoc, limitToLast, limit, deleteField, Timestamp } from 'firebase/firestore';
import { closeChatPair, getChatId, hasMsgData, openChatPair, openMsg, resealMsgBody, sealMsg } from '../crypto/chat.js';
import { orderChatKeys } from '../crypto/pair.js';
import { putAttachment, putFile, putImg, putMp3, putMp4, readMsgFile } from './media.js';
import { canShowMsg, canStoreMsg, isControlMsg, isExpiredMsg, makeReaction, makeReadReceipt } from './messages.js';
import { openChatSettingsForPair, sealChatSettingsForPair } from './settings.js';
import { getMessageKey, makeCid } from './state.js';
import { cleanChatRetention, newMessageTtlMs, seenMessageTtlMs, shouldShortenTtl } from './ttl.js';

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

function makeTtl(value) {
    if (value == null) {
        return null;
    }
    if (typeof value?.toMillis === 'function') {
        return value;
    }
    const ms = Number(value);
    return Number.isFinite(ms) && ms > 0 ? Timestamp.fromMillis(ms) : null;
}

function getMessageTtl(retention) {
    return makeTtl(newMessageTtlMs(retention));
}

function makeChatLastMsg(msgData) {
    return {
        head: msgData.head,
        body: msgData.body,
        ttl: msgData.ttl,
    };
}

function makeUpdatedChatLastMsg(lastMsg, fields = {}) {
    return {
        head: lastMsg?.head,
        body: fields.body ?? lastMsg?.body,
        ttl: 'ttl' in fields ? fields.ttl : (lastMsg?.ttl ?? null),
    };
}

function getSeenTtl(ttlMs = seenMessageTtlMs()) {
    return makeTtl(ttlMs);
}

function messageDataExpired(msgData, now = Date.now()) {
    return isExpiredMsg({ ttl: msgData?.ttl ?? null }, now);
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
        ttl: getMessageTtl(options?.retention ?? options?.ttlMode),
    };

    const batch = writeBatch(db);
    const msgRef = doc(collection(chatRef, 'messages'));
    batch.set(msgRef, msgData);
    if (updateLastMsg) {
        batch.set(chatRef, { participants: sortedKeys, lastMsg: makeChatLastMsg(msgData), ts: serverTimestamp() }, { mergeFields: ['participants', 'lastMsg', 'ts'] });
    }
    await batch.commit();
    return { chatId, msgId: msgRef.id, cid: head.cid };
}

export async function sendReadReceipt(db, senderPubkey, senderPrivkey, receiverChatPK, target, options = {}) {
    const receipt = {
        ...makeReadReceipt(target),
        cid: makeCid(),
        s: senderPubkey,
    };
    return sendMsg(db, senderPubkey, senderPrivkey, receiverChatPK, receipt, { updateLastMsg: false, ...options });
}

export async function sendReaction(db, senderPubkey, senderPrivkey, receiverChatPK, target, emoji, options = {}) {
    const reaction = {
        ...makeReaction(target, emoji),
        cid: makeCid(),
        s: senderPubkey,
    };
    return sendMsg(db, senderPubkey, senderPrivkey, receiverChatPK, reaction, { updateLastMsg: false, ...options });
}

function messageTtlUpdateItems(messages, ttl) {
    const nextTtlMs = toMillis(ttl, null);
    const seen = new Set();
    const items = [];
    for (const message of messages || []) {
        const id = typeof message?.id === 'string' ? message.id.trim() : '';
        if (!id || id.startsWith('local:') || seen.has(id) || message.pending || message.failed) {
            continue;
        }
        if (!shouldShortenTtl(message.ttl, nextTtlMs)) {
            continue;
        }
        seen.add(id);
        items.push({
            id,
            cid: typeof message?.cid === 'string' ? message.cid : '',
        });
    }
    return items;
}

function messagePermanentUpdateItems(messages) {
    const seen = new Set();
    const list = Array.isArray(messages) ? messages : [messages];
    const items = [];
    for (const message of list || []) {
        const id = typeof message?.id === 'string' ? message.id.trim() : '';
        if (!id || id.startsWith('local:') || seen.has(id) || message.pending || message.failed || message.ttl == null) {
            continue;
        }
        seen.add(id);
        items.push({
            id,
            cid: typeof message?.cid === 'string' ? message.cid : '',
        });
    }
    return items;
}

function messageTemporaryUpdateItems(messages) {
    const seen = new Set();
    const list = Array.isArray(messages) ? messages : [messages];
    const items = [];
    for (const message of list || []) {
        const id = typeof message?.id === 'string' ? message.id.trim() : '';
        if (!id || id.startsWith('local:') || seen.has(id) || message.pending || message.failed || message.ttl != null) {
            continue;
        }
        seen.add(id);
        items.push({
            id,
            cid: typeof message?.cid === 'string' ? message.cid : '',
        });
    }
    return items;
}

export async function updateSeenMsgTtls(db, chatId, messages, ttlMs = seenMessageTtlMs()) {
    if (!db || !chatId || !Array.isArray(messages) || !messages.length) {
        return 0;
    }

    const ttl = getSeenTtl(ttlMs);
    const items = messageTtlUpdateItems(messages, ttl);
    if (!items.length) {
        return 0;
    }

    const chatRef = doc(db, 'chats', chatId);
    const chatSnap = await getDoc(chatRef).catch(() => null);
    const lastCid = chatSnap?.exists?.() ? (chatSnap.data()?.lastMsg?.head?.cid ?? null) : null;
    const updateLastMsg = !!lastCid && items.some((item) => item.cid && item.cid === lastCid);

    for (let index = 0; index < items.length; index += 400) {
        const batch = writeBatch(db);
        const chunk = items.slice(index, index + 400);
        for (const item of chunk) {
            batch.update(doc(db, 'chats', chatId, 'messages', item.id), { ttl });
        }
        if (updateLastMsg && index === 0) {
            batch.update(chatRef, { lastMsg: makeUpdatedChatLastMsg(chatSnap.data()?.lastMsg, { ttl }) });
        }
        await batch.commit();
    }

    return items.length;
}

export async function makeMsgTemporary(db, chatId, messages, ttlMs = newMessageTtlMs()) {
    if (!db || !chatId) {
        return 0;
    }

    const ttl = getSeenTtl(ttlMs);
    const items = messageTemporaryUpdateItems(messages);
    if (!ttl || !items.length) {
        return 0;
    }

    const chatRef = doc(db, 'chats', chatId);
    const chatSnap = await getDoc(chatRef).catch(() => null);
    const lastCid = chatSnap?.exists?.() ? (chatSnap.data()?.lastMsg?.head?.cid ?? null) : null;
    const updateLastMsg = !!lastCid && items.some((item) => item.cid && item.cid === lastCid);

    for (let index = 0; index < items.length; index += 400) {
        const batch = writeBatch(db);
        const chunk = items.slice(index, index + 400);
        for (const item of chunk) {
            batch.update(doc(db, 'chats', chatId, 'messages', item.id), { ttl });
        }
        if (updateLastMsg && index === 0) {
            batch.update(chatRef, { lastMsg: makeUpdatedChatLastMsg(chatSnap.data()?.lastMsg, { ttl }) });
        }
        await batch.commit();
    }

    return items.length;
}

export async function makeMsgPermanent(db, chatId, messages) {
    if (!db || !chatId) {
        return 0;
    }

    const items = messagePermanentUpdateItems(messages);
    if (!items.length) {
        return 0;
    }

    const chatRef = doc(db, 'chats', chatId);
    const chatSnap = await getDoc(chatRef).catch(() => null);
    const lastCid = chatSnap?.exists?.() ? (chatSnap.data()?.lastMsg?.head?.cid ?? null) : null;
    const updateLastMsg = !!lastCid && items.some((item) => item.cid && item.cid === lastCid);

    for (let index = 0; index < items.length; index += 400) {
        const batch = writeBatch(db);
        const chunk = items.slice(index, index + 400);
        for (const item of chunk) {
            batch.update(doc(db, 'chats', chatId, 'messages', item.id), { ttl: null });
        }
        if (updateLastMsg && index === 0) {
            batch.update(chatRef, { lastMsg: makeUpdatedChatLastMsg(chatSnap.data()?.lastMsg, { ttl: null }) });
        }
        await batch.commit();
    }

    return items.length;
}

export async function setChatRetention(db, chatId, senderPubkey, senderPrivkey, peerChatPK, retention) {
    if (!senderPubkey || !senderPrivkey || !peerChatPK) {
        throw new Error('vault locked');
    }
    const nextRetention = cleanChatRetention(retention);
    const pair = await getCachedPair(senderPubkey, senderPrivkey, peerChatPK);
    const settings = await sealChatSettingsForPair(pair, { retention: nextRetention });
    await updateDoc(doc(db, 'chats', chatId), { settings });
    return nextRetention;
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
    // Do not touch lastMsg.head so edits cannot create false unseen state.
    const syncLastMsg = options?.updateLastMsg !== false;
    const nextCid = syncLastMsg && typeof newMessage?.cid === 'string' ? newMessage.cid : '';
    if (nextCid) {
        try {
            const chatRef = doc(db, 'chats', chatId);
            const chatSnap = await getDoc(chatRef);
            const lastMsg = chatSnap.exists() ? chatSnap.data()?.lastMsg : null;
            if (lastMsg?.head?.cid === nextCid) {
                await updateDoc(chatRef, { lastMsg: makeUpdatedChatLastMsg(lastMsg, { body }) });
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
    const batch = writeBatch(db);
    // Stored attachment blobs can be shared by reference, so deleting a message
    // must not delete the underlying Firebase Storage object.
    batch.delete(msgRef);

    if (syncLastMsg) {
        batch.update(chatRef, { lastMsg: deleteField() });
    }

    await batch.commit();
    return true;
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

async function handleChats(db, docs, userChatPK, userPrivKey, onUpdate) {
    const chats = await Promise.all(
        docs.map(async (docSnap) => {
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
                          .then((message) => normalizeDecryptedMsg({ ...lastMsgData, ts: data?.ts ?? null }, message))
                          .catch(() => null)
                    : null;
            const visibleLastMsg = lastMsg && canShowMsg(lastMsg) && !isControlMsg(lastMsg) ? lastMsg : null;
            const ts = toMillis(data?.ts, null);
            if (!ts) {
                return null;
            }
            if (lastMsgData && !visibleLastMsg) {
                void updateDoc(doc(db, 'chats', docSnap.id), { lastMsg: deleteField() }).catch(() => {});
            }
            const unseen = visibleLastMsg ? isChatUnseenForUser({ lastMsg: visibleLastMsg }, userChatPK) : false;
            return { id: docSnap.id, participants, settings, lastMsg: visibleLastMsg, ts, unseen };
        })
    );
    const readyChats = chats.filter(Boolean).sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
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
                if (messageDataExpired(docSnap.data())) {
                    return false;
                }
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
        const olderDocs = (usingSnapshotCursor ? snap.docs.slice(0, -1) : snap.docs).filter((docSnap) => !messageDataExpired(docSnap.data()));
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
