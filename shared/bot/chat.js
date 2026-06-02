import { CHAT_PAIR_CACHE_LIMIT } from '../config.js';
import { closeChatPair, hasMsgData, openChatPair, openMsg, sealMsg } from '../crypto/chat.js';
import { orderChatKeys } from '../crypto/pair.js';
import { putBotAttachment, readBotAttachment } from './storage.js';
import { canStoreMsg } from '../chat/messages.js';
import { cleanChatRetention, newMessageTtlMs, withMessageRetention } from '../chat/ttl.js';
import { CHAT_ACTION_OPS } from '../chat/messages/actions.js';
import { makeCid } from '../chat/state.js';
import { makeOwnChatEntry, openOwnChatEntry, ownChatEntryId, sealChatWake, sealOwnChatEntry } from '../chat/entries.js';
import { cleanText } from '../utils/text.js';

const pairCache = new Map();
const MAX_PAIR_CACHE = CHAT_PAIR_CACHE_LIMIT;

function getPairKey(chatPK, peerChatPK) {
    if (!chatPK || !peerChatPK) {
        return null;
    }
    return orderChatKeys(chatPK, peerChatPK).join('|');
}

async function getCachedBotPair(chatPK, chatPrivKey, peerChatPK) {
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

function makeTtlDate(retention) {
    const ms = newMessageTtlMs(retention);
    return Number.isFinite(ms) ? new Date(ms) : null;
}

function isAlreadyExists(error) {
    const code = error?.code;
    if (code === 6 || code === '6') {
        return true;
    }
    const label = String(code ?? error?.details ?? error?.message ?? '').toUpperCase();
    return label.includes('ALREADY_EXISTS') || /already exists/i.test(String(error?.message ?? ''));
}

function adminBytes(value) {
    return typeof value?.toUint8Array === 'function' ? Buffer.from(value.toUint8Array()) : value;
}

async function profileByChatPK(db, chatPK) {
    const snap = await db.collection('profiles').where('chatPK', '==', chatPK).limit(1).get();
    const doc = snap.docs?.[0];
    if (!doc) {
        return null;
    }
    const data = doc.data() || {};
    return {
        uid: cleanText(data.uid) || doc.id,
    };
}

async function writeBotOwnerEntry(db, senderUid, senderChatPrivKey, pair, fields = {}) {
    const uid = cleanText(senderUid);
    if (!uid) {
        return null;
    }
    const entryId = ownChatEntryId(senderChatPrivKey, pair.chatId);
    const ref = db.collection('users').doc(uid).collection('chats').doc(entryId);
    const snap = await ref.get().catch(() => null);
    const existing = snap?.exists ? await openOwnChatEntry(senderChatPrivKey, entryId, snap.data()?.body).catch(() => null) : null;
    const entry = makeOwnChatEntry(pair, {
        peerUid: fields.peerUid || existing?.peerUid,
        actors: existing?.actors || {},
        settings: existing?.settings,
        lastMsg: fields.lastMsg || existing?.lastMsg,
    });
    return {
        ref,
        data: {
            body: adminBytes(await sealOwnChatEntry(senderChatPrivKey, entryId, entry)),
            ts: fields.ts,
        },
    };
}

export async function hasBotMsg(db, chatId, msgId) {
    if (!db || !chatId || !msgId) {
        return false;
    }
    const snap = await db.collection('chats').doc(chatId).collection('messages').doc(msgId).get();
    return snap.exists;
}

export async function decryptBotMsg(msgData, userChatPK, userChatPrivKey, peerChatPK, options = {}) {
    if (!hasMsgData(msgData) || !userChatPK || !userChatPrivKey || !peerChatPK) {
        return null;
    }

    const pair = await getCachedBotPair(userChatPK, userChatPrivKey, peerChatPK);
    const message = await openMsg(pair, msgData, { actors: options?.actors });
    return normalizeMessage(msgData, message);
}

export async function decryptBotChatSettings(settingsData, userChatPK, userChatPrivKey, peerChatPK) {
    return settingsData || null;
}

export async function sendBotMsg(db, FieldValue, senderChatPK, senderChatPrivKey, receiverChatPK, message, options = {}) {
    if (!db || !FieldValue) {
        throw new Error('firestore required');
    }
    if (!senderChatPK || !senderChatPrivKey) {
        throw new Error('bot chat keys required');
    }

    const updateLastMsg = options?.updateLastMsg !== false;
    const msgId = cleanText(options?.msgId);
    const pair = await getCachedBotPair(senderChatPK, senderChatPrivKey, receiverChatPK);
    const chatId = pair.chatId;
    const retention = cleanChatRetention(options?.retention ?? options?.ttlMode);
    const tsMs = Date.now();
    const msgTs = new Date(tsMs);
    const { head, body } = await sealMsg(pair, withMessageRetention(message, retention), { ts: tsMs });
    const rawBody = adminBytes(body);
    const chatRef = db.collection('chats').doc(chatId);
    const msgRef = msgId ? chatRef.collection('messages').doc(msgId) : chatRef.collection('messages').doc();
    const ts = FieldValue.serverTimestamp();
    const msgData = {
        head,
        body: rawBody,
        ts,
        ttl: makeTtlDate(retention),
    };
    const recipientProfile = updateLastMsg ? await profileByChatPK(db, receiverChatPK).catch(() => null) : null;
    const ownerEntry = updateLastMsg
        ? await writeBotOwnerEntry(db, options?.senderUid, senderChatPrivKey, pair, {
              peerUid: recipientProfile?.uid,
              ts: msgTs,
              lastMsg: {
                  ...withMessageRetention(message, retention),
                  s: senderChatPK,
                  from: senderChatPK,
                  cid: head.cid,
                  id: msgRef.id,
                  ts: msgTs,
                  ttl: makeTtlDate(retention),
                  pending: false,
                  failed: false,
              },
          })
        : null;
    const wake = recipientProfile?.uid && updateLastMsg
        ? await sealChatWake(senderChatPK, senderChatPrivKey, receiverChatPK, {
              kind: 'message',
              senderUid: options?.senderUid,
              messageId: msgRef.id,
              ts: tsMs,
          })
        : null;

    const batch = db.batch();
    if (msgId) {
        batch.create(msgRef, msgData);
    } else {
        batch.set(msgRef, msgData);
    }
    if (updateLastMsg) {
        batch.set(chatRef, { v: 1, ts }, { merge: true });
    }
    if (ownerEntry) {
        batch.set(ownerEntry.ref, ownerEntry.data, { merge: true });
    }
    if (wake) {
        batch.set(db.collection('users').doc(recipientProfile.uid).collection('chatInbox').doc(), {
            ...wake,
            body: adminBytes(wake.body),
            ts,
        });
    }
    try {
        await batch.commit();
    } catch (error) {
        if (msgId && isAlreadyExists(error)) {
            return { chatId, msgId, skipped: true };
        }
        throw error;
    }

    return { chatId, msgId: msgRef.id };
}

export async function updateBotMsg(db, chatId, msgId, senderChatPK, senderChatPrivKey, receiverChatPK, newMessage) {
    if (!db || !chatId || !msgId) {
        throw new Error('message ref required');
    }
    if (!senderChatPrivKey || !receiverChatPK) {
        throw new Error('bot chat keys required');
    }

    const pair = await getCachedBotPair(senderChatPK, senderChatPrivKey, receiverChatPK);
    if (pair.chatId !== chatId) {
        throw new Error('chat mismatch');
    }
    const target = cleanText(newMessage?.cid) || cleanText(msgId);
    const op = newMessage?.t === 'req' && cleanText(newMessage?.tx) ? CHAT_ACTION_OPS.PAY_CONFIRM : CHAT_ACTION_OPS.EDIT;
    const { head, body } = await sealMsg(pair, { ...(newMessage || {}), cid: makeCid(), s: senderChatPK }, { op, target });
    const rawBody = adminBytes(body);
    await db.collection('chats').doc(chatId).collection('messages').doc().set({
        head,
        body: rawBody,
        ts: new Date(),
        ttl: null,
    });
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

    const cid = cleanText(attachment?.cid);
    if (!cid) {
        throw new Error('message cid required');
    }

    const pair = await getCachedBotPair(senderChatPK, senderChatPrivKey, receiverChatPK);
    return putBotAttachment(bucket, pair, cid, attachment?.type, attachment?.data, attachment?.meta || {});
}

export async function uploadBotAttachmentMsg(db, FieldValue, bucket, senderChatPK, senderChatPrivKey, receiverChatPK, attachment = {}, options = {}) {
    const cid = cleanText(attachment?.cid);
    if (!cid) {
        throw new Error('message cid required');
    }

    const msg = await uploadBotAttachment(bucket, senderChatPK, senderChatPrivKey, receiverChatPK, attachment);
    return sendBotMsg(db, FieldValue, senderChatPK, senderChatPrivKey, receiverChatPK, { ...msg, cid }, options);
}
