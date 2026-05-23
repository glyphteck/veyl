import { closeChatPair, getChatId, hasMsgData, openChatPair, openMsg, resealMsgBody, sealMsg } from '../crypto/chat.js';
import { orderChatKeys } from '../crypto/pair.js';
import { putBotAttachment, readBotAttachment } from './storage.js';
import { canStoreMsg } from '../chat/messages.js';
import { openChatSettingsForPair } from '../chat/settings.js';
import { cleanChatRetention, newMessageTtlMs, withMessageRetention } from '../chat/ttl.js';

const pairCache = new Map();
const MAX_PAIR_CACHE = 256;

function getPairKey(chatPK, peerChatPK) {
    if (!chatPK || !peerChatPK) {
        return null;
    }
    return orderChatKeys(chatPK, peerChatPK).join('|');
}

async function getCachedPair(chatPK, chatPrivKey, peerChatPK) {
    const key = getPairKey(chatPK, peerChatPK);
    if (!key) {
        return openChatPair(chatPK, chatPrivKey, peerChatPK);
    }

    const cached = pairCache.get(key);
    if (cached) {
        return cached;
    }

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

export function clearBotChatPairCache() {
    for (const pair of pairCache.values()) {
        closeChatPair(pair);
    }
    pairCache.clear();
}

function normalizeMessage(msgData, message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return null;
    }

    const normalized = {
        ...message,
        ts: msgData?.ts ?? null,
        ttl: msgData?.ttl ?? null,
    };
    return canStoreMsg(normalized) ? normalized : null;
}

function makeTtl(retention) {
    const ms = newMessageTtlMs(retention);
    return Number.isFinite(ms) ? new Date(ms) : null;
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

export async function decryptBotMsg(msgData, userChatPK, userChatPrivKey, peerChatPK) {
    if (!hasMsgData(msgData) || !userChatPK || !userChatPrivKey || !peerChatPK) {
        return null;
    }

    const pair = await getCachedPair(userChatPK, userChatPrivKey, peerChatPK);
    const message = await openMsg(pair, msgData);
    return normalizeMessage(msgData, message);
}

export async function decryptBotChatSettings(settingsData, userChatPK, userChatPrivKey, peerChatPK) {
    if (!userChatPK || !userChatPrivKey || !peerChatPK) {
        return null;
    }

    const pair = await getCachedPair(userChatPK, userChatPrivKey, peerChatPK);
    return openChatSettingsForPair(pair, settingsData);
}

export async function sendBotMsg(db, FieldValue, senderChatPK, senderChatPrivKey, receiverChatPK, message, options = {}) {
    if (!db || !FieldValue) {
        throw new Error('firestore required');
    }
    if (!senderChatPK || !senderChatPrivKey) {
        throw new Error('bot chat keys required');
    }

    const updateLastMsg = options?.updateLastMsg !== false;
    const msgId = typeof options?.msgId === 'string' ? options.msgId.trim() : '';
    const sortedKeys = orderChatKeys(senderChatPK, receiverChatPK);
    const chatId = getChatId(senderChatPK, receiverChatPK);
    const pair = await getCachedPair(senderChatPK, senderChatPrivKey, receiverChatPK);
    const retention = cleanChatRetention(options?.retention ?? options?.ttlMode);
    const { head, body } = await sealMsg(pair, withMessageRetention(message, retention));
    const rawBody = typeof body?.toUint8Array === 'function' ? Buffer.from(body.toUint8Array()) : body;
    const chatRef = db.collection('chats').doc(chatId);
    const msgRef = msgId ? chatRef.collection('messages').doc(msgId) : chatRef.collection('messages').doc();
    if (msgId && (await msgRef.get()).exists) {
        return { chatId, msgId, skipped: true };
    }
    const msgData = {
        head,
        body: rawBody,
        ts: FieldValue.serverTimestamp(),
        ttl: makeTtl(retention),
    };

    const batch = db.batch();
    batch.set(msgRef, msgData);
    if (updateLastMsg) {
        batch.set(chatRef, { participants: sortedKeys, lastMsg: makeChatLastMsg(msgData), ts: FieldValue.serverTimestamp() }, { mergeFields: ['participants', 'lastMsg', 'ts'] });
    }
    await batch.commit();

    return { chatId, msgId: msgRef.id };
}

export async function updateBotMsg(db, chatId, msgId, senderChatPrivKey, receiverChatPK, newMessage) {
    if (!db || !chatId || !msgId) {
        throw new Error('message ref required');
    }
    if (!senderChatPrivKey || !receiverChatPK) {
        throw new Error('bot chat keys required');
    }

    const senderChatPK = chatId.split('_').find((part) => part && part !== receiverChatPK);

    if (!senderChatPK) {
        throw new Error('sender chat key missing');
    }

    const pair = await getCachedPair(senderChatPK, senderChatPrivKey, receiverChatPK);
    const msgRef = db.collection('chats').doc(chatId).collection('messages').doc(msgId);
    const msgSnap = await msgRef.get();
    if (!msgSnap.exists) {
        throw new Error('message not found');
    }

    const current = msgSnap.data();
    const body = await resealMsgBody(pair, current.head, newMessage);
    const rawBody = typeof body?.toUint8Array === 'function' ? Buffer.from(body.toUint8Array()) : body;
    await msgRef.set({ body: rawBody }, { merge: true });

    const nextCid = typeof newMessage?.cid === 'string' ? newMessage.cid : '';
    if (!nextCid) {
        return;
    }

    const chatRef = db.collection('chats').doc(chatId);
    const chatSnap = await chatRef.get();
    const lastMsg = chatSnap.exists ? chatSnap.data()?.lastMsg : null;
    if (lastMsg?.head?.cid !== nextCid) {
        return;
    }

    await chatRef.update({ lastMsg: makeUpdatedChatLastMsg(lastMsg, { body: rawBody }) });
}

export async function readBotMsgAttachment(bucket, userChatPK, userChatPrivKey, peerChatPK, msg) {
    if (!bucket) {
        throw new Error('storage bucket required');
    }
    if (!userChatPK || !userChatPrivKey || !peerChatPK || !msg) {
        return null;
    }

    return readBotAttachment(bucket, msg);
}

export async function uploadBotAttachment(bucket, senderChatPK, senderChatPrivKey, receiverChatPK, attachment = {}) {
    if (!bucket) {
        throw new Error('storage bucket required');
    }
    if (!senderChatPK || !senderChatPrivKey || !receiverChatPK) {
        throw new Error('bot chat keys required');
    }

    const cid = typeof attachment?.cid === 'string' ? attachment.cid.trim() : '';
    if (!cid) {
        throw new Error('message cid required');
    }

    const pair = await getCachedPair(senderChatPK, senderChatPrivKey, receiverChatPK);
    return putBotAttachment(bucket, pair, cid, attachment?.type, attachment?.data, attachment?.meta || {});
}

export async function uploadBotAttachmentMsg(db, FieldValue, bucket, senderChatPK, senderChatPrivKey, receiverChatPK, attachment = {}, options = {}) {
    const cid = typeof attachment?.cid === 'string' ? attachment.cid.trim() : '';
    if (!cid) {
        throw new Error('message cid required');
    }

    const msg = await uploadBotAttachment(bucket, senderChatPK, senderChatPrivKey, receiverChatPK, attachment);
    return sendBotMsg(db, FieldValue, senderChatPK, senderChatPrivKey, receiverChatPK, { ...msg, cid }, options);
}
