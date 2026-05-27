import { collection, query, where, orderBy, onSnapshot, doc, serverTimestamp, updateDoc, writeBatch, endAt, endBefore, getDocs, getDocsFromServer, getDoc, getDocFromServer, limitToLast, limit, startAfter, deleteField, Timestamp } from 'firebase/firestore';
import { closeChatPair, getChatId, hasMsgData, openChatPair, openMsg, resealMsgBody, sealMsg } from '../crypto/chat.js';
import { orderChatKeys } from '../crypto/pair.js';
import { putAttachment, putFile, putImg, putMp3, putMp4, readMsgFile } from './media.js';
import { canShowMsg, canStoreMsg, isControlMsg, isExpiredMsg, makeReaction, makeReadReceipt, makeRetentionSystemMsg } from './messages.js';
import { openChatSettingsForPair, sealChatSettingsForPair } from './settings.js';
import { getMessageKey, makeCid } from './state.js';
import { cleanChatRetention, newMessageTtlMs, seenMessageTtlMs, shouldShortenTtl, withMessageRetention } from './ttl.js';

export const MSG_BATCH_SIZE = 40;
const MSG_QUERY_MULTIPLIER = 3;
const MSG_QUERY_EXTRA = 8;
// Rules must prove chat membership for each TTL write; batching many messages
// can exceed Firestore's rule access-call limit while costing the same writes.
const TTL_WRITE_BATCH_SIZE = 1;
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

async function getServerSnap(ref) {
    return getDocFromServer(ref).catch(() => null);
}

function chatLastMsg(chatSnap) {
    return chatSnap?.exists?.() ? (chatSnap.data()?.lastMsg ?? null) : null;
}

function chatLastCid(lastMsg) {
    return lastMsg?.head?.cid ?? null;
}

async function syncChatLastMsgBestEffort(chatRef, lastMsg, fields) {
    if (!lastMsg?.head || !lastMsg?.body) {
        return false;
    }

    try {
        await updateDoc(chatRef, { lastMsg: makeUpdatedChatLastMsg(lastMsg, fields) });
        return true;
    } catch {
        return false;
    }
}

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

function valueMillis(value) {
    if (value == null) {
        return null;
    }
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (Number.isFinite(value)) {
        return value;
    }
    return String(value);
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

function messageDocDataEqual(a, b) {
    if (a === b) {
        return true;
    }
    return !!a && !!b && envelopesEqual(a, b) && valueMillis(a.ts ?? null) === valueMillis(b.ts ?? null);
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

function messageQueryLimit(pageSize) {
    return positiveInt(pageSize, MSG_BATCH_SIZE) * MSG_QUERY_MULTIPLIER + MSG_QUERY_EXTRA;
}

function positiveInt(value, fallback) {
    const next = Math.trunc(Number(value));
    return Number.isFinite(next) && next > 0 ? next : fallback;
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
    const retention = cleanChatRetention(options?.retention ?? options?.ttlMode);
    const { head, body } = await sealMsg(pair, withMessageRetention(message, retention));
    const chatRef = doc(db, 'chats', chatId);
    const msgData = {
        head,
        body,
        ts: serverTimestamp(),
        ttl: getMessageTtl(retention),
    };

    const batch = writeBatch(db);
    const msgRef = doc(collection(chatRef, 'messages'));
    batch.set(msgRef, msgData);
    if (updateLastMsg) {
        const chatUpdate = { lastMsg: makeChatLastMsg(msgData), ts: serverTimestamp() };
        if (options?.chatExists === true) {
            batch.update(chatRef, chatUpdate);
        } else {
            batch.set(chatRef, { participants: sortedKeys, ...chatUpdate }, { mergeFields: ['participants', 'lastMsg', 'ts'] });
        }
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
    const lastMsg = chatLastMsg(await getServerSnap(chatRef));
    const lastCid = chatLastCid(lastMsg);
    const updateLastMsg = !!lastCid && items.some((item) => item.cid && item.cid === lastCid);

    for (let index = 0; index < items.length; index += TTL_WRITE_BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = items.slice(index, index + TTL_WRITE_BATCH_SIZE);
        for (const item of chunk) {
            batch.update(doc(db, 'chats', chatId, 'messages', item.id), { ttl });
        }
        await batch.commit();
    }
    if (updateLastMsg) {
        await syncChatLastMsgBestEffort(chatRef, lastMsg, { ttl });
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
    const lastMsg = chatLastMsg(await getServerSnap(chatRef));
    const lastCid = chatLastCid(lastMsg);
    const updateLastMsg = !!lastCid && items.some((item) => item.cid && item.cid === lastCid);

    for (let index = 0; index < items.length; index += TTL_WRITE_BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = items.slice(index, index + TTL_WRITE_BATCH_SIZE);
        for (const item of chunk) {
            batch.update(doc(db, 'chats', chatId, 'messages', item.id), { ttl });
        }
        await batch.commit();
    }
    if (updateLastMsg) {
        await syncChatLastMsgBestEffort(chatRef, lastMsg, { ttl });
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
    const lastMsg = chatLastMsg(await getServerSnap(chatRef));
    const lastCid = chatLastCid(lastMsg);
    const updateLastMsg = !!lastCid && items.some((item) => item.cid && item.cid === lastCid);

    for (let index = 0; index < items.length; index += TTL_WRITE_BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = items.slice(index, index + TTL_WRITE_BATCH_SIZE);
        for (const item of chunk) {
            batch.update(doc(db, 'chats', chatId, 'messages', item.id), { ttl: null });
        }
        await batch.commit();
    }
    if (updateLastMsg) {
        await syncChatLastMsgBestEffort(chatRef, lastMsg, { ttl: null });
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
    const systemMessage = {
        ...makeRetentionSystemMsg(nextRetention),
        cid: makeCid(),
        s: senderPubkey,
    };
    const chatRef = doc(db, 'chats', chatId);
    await updateDoc(chatRef, { settings });
    await sendMsg(db, senderPubkey, senderPrivkey, peerChatPK, systemMessage, {
        updateLastMsg: false,
        retention: nextRetention,
        chatExists: true,
    });
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
            const lastMsg = chatLastMsg(await getServerSnap(chatRef));
            if (lastMsg?.head?.cid === nextCid) {
                await updateDoc(chatRef, { lastMsg: makeUpdatedChatLastMsg(lastMsg, { body }) });
            }
        } catch {}
    }
}

export async function deleteMsg(db, chatId, msgId) {
    if (!db || !chatId || !msgId) {
        return false;
    }

    const chatRef = doc(db, 'chats', chatId);
    const msgRef = doc(db, 'chats', chatId, 'messages', msgId);
    const [chatSnap, msgSnap] = await Promise.all([getServerSnap(chatRef), getDoc(msgRef)]);

    if (!msgSnap.exists()) {
        return false;
    }

    const current = msgSnap.data();
    const currentCid = current?.head?.cid ?? null;
    const lastCid = chatLastCid(chatLastMsg(chatSnap));
    const syncLastMsg = !!chatSnap?.exists?.() && !!currentCid && currentCid === lastCid;
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
    return decryptChatDoc(db, snap, userChatPK, userPrivKey);
}

async function decryptChatDoc(db, docSnap, userChatPK, userPrivKey) {
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
    const unseen = visibleLastMsg ? isChatUnseenForUser({ lastMsg: visibleLastMsg }, userChatPK) : false;
    return { id: docSnap.id, participants, settings, lastMsg: visibleLastMsg, ts, unseen };
}

async function chatRowFromDoc(db, docSnap, userChatPK, userPrivKey, cache) {
    const data = docSnap.data();
    const cached = cache?.get?.(docSnap.id);
    if (cached && chatDocDataEqual(cached.data, data)) {
        return cached.chat;
    }

    const chat = await decryptChatDoc(db, docSnap, userChatPK, userPrivKey);
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
                // body update is pending. We still hide brand-new pending docs so
                // optimistic local sends remain owned by localByChat until acked.
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
