import { CHAT_PAIR_CACHE_LIMIT } from '../config.js';
import { closeChatPair, hasMsgData, openChatPair, openMsg, sealMsg } from '../crypto/chat.js';
import { orderChatKeys } from '../crypto/pair.js';
import { putBotAttachment, readBotAttachment } from './storage.js';
import { canStoreMsg } from '../chat/messages.js';
import { cleanChatRetention, newMessageTtlMs, withMessageRetention } from '../chat/ttl.js';
import { CHAT_ACTION_OPS } from '../chat/messages/actions.js';
import { makeCid } from '../chat/state.js';
import { makeOwnChatEntry, openOwnChatEntry, ownChatEntryId, sealOwnChatEntry } from '../chat/entry.js';
import { sealPing } from '../chat/ping.js';
import { randomBytes, toHex } from '../crypto/core.js';
import { cleanText } from '../utils/text.js';

const pairCache = new Map();
const MAX_PAIR_CACHE = CHAT_PAIR_CACHE_LIMIT;
const VERBOSE = typeof process !== 'undefined' && process.env?.VEYL_VERBOSE === '1';
const CHAT_ID_RE = /^[0-9a-f]{64}$/i;

function safeLogId(value) {
    const text = cleanText(value);
    return text ? `${text.slice(0, 8)}:${text.length}` : null;
}

function botFirestoreLog(op, fields = {}) {
    if (VERBOSE) {
        console.log('[bot:firestore]', op, fields);
    }
}

function cleanChatId(value) {
    const chatId = cleanText(value).toLowerCase();
    return CHAT_ID_RE.test(chatId) ? chatId : '';
}

function cleanLinkId(value) {
    return cleanChatId(value);
}

function cleanVersion(value) {
    return Number.isInteger(value) && value > 0 ? value : 0;
}

function makeChatId() {
    return toHex(randomBytes(32));
}

function getPairKey(chatPK, peerChatPK, chatId = '') {
    if (!chatPK || !peerChatPK) {
        return null;
    }
    return `${orderChatKeys(chatPK, peerChatPK).join('|')}|${cleanText(chatId)}`;
}

async function getCachedBotPair(chatPK, chatPrivKey, peerChatPK, options = {}) {
    const chatId = cleanChatId(options?.chatId);
    const key = getPairKey(chatPK, peerChatPK, chatId);
    if (!key) {
        return openChatPair(chatPK, chatPrivKey, peerChatPK, { chatId });
    }

    const cached = pairCache.get(key);
    if (cached) {
        return cached;
    }

    const pair = await openChatPair(chatPK, chatPrivKey, peerChatPK, { chatId });
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

async function openBotChatLink(db, FieldValue, linkId) {
    const ref = db.collection('links').doc(linkId);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.data()?.chat || {};
        const activeId = cleanChatId(current.id);
        const version = cleanVersion(current.version);

        if (activeId) {
            const chatSnap = await tx.get(db.collection('chats').doc(activeId));
            if (!chatSnap.data()?.deleted) {
                return { id: activeId, version, exists: true };
            }
        }

        const next = {
            id: makeChatId(),
            version: version + 1,
        };
        tx.set(
            ref,
            {
                chat: {
                    id: next.id,
                    version: next.version,
                    ts: FieldValue.serverTimestamp(),
                },
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
        return { ...next, exists: false };
    });
}

async function resolveBotPair(db, FieldValue, chatPK, chatPrivKey, peerChatPK, options = {}) {
    const chatId = cleanChatId(options?.chatId);
    if (chatId) {
        return getCachedBotPair(chatPK, chatPrivKey, peerChatPK, { chatId });
    }

    const basePair = await getCachedBotPair(chatPK, chatPrivKey, peerChatPK);
    const linkId = cleanLinkId(options?.linkId) || basePair.linkId;
    const linkChat = await openBotChatLink(db, FieldValue, linkId);
    if (!linkChat?.id) {
        throw new Error('chat link unavailable');
    }
    return getCachedBotPair(chatPK, chatPrivKey, peerChatPK, { chatId: linkChat.id });
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

function callablePing(ping) {
    const body = ping?.body;
    if (typeof body?.toBase64 !== 'function') {
        throw new Error('inbox ping body unavailable');
    }
    return {
        v: ping.v,
        epk: ping.epk,
        body: body.toBase64(),
    };
}

async function profileByChatPK(db, chatPK) {
    botFirestoreLog('read profiles by chatPK', { chatPK: safeLogId(chatPK) });
    const snap = await db.collection('profiles').where('chatPK', '==', chatPK).limit(1).get();
    const doc = snap.docs?.[0];
    botFirestoreLog('read profiles by chatPK done', { chatPK: safeLogId(chatPK), hit: Boolean(doc) });
    if (!doc) {
        return null;
    }
    const data = doc.data() || {};
    return {
        uid: cleanText(data.uid) || doc.id,
    };
}

async function recipientForSend(db, chatPK, options, needed) {
    if (!needed) {
        return null;
    }
    const uid = cleanText(options?.receiverUid);
    if (uid) {
        return { uid };
    }
    return profileByChatPK(db, chatPK).catch(() => null);
}

async function writeBotOwnerEntry(db, senderUid, senderChatPrivKey, pair, fields = {}) {
    const uid = cleanText(senderUid);
    if (!uid) {
        return null;
    }
    const entryId = ownChatEntryId(senderChatPrivKey, pair.chatId);
    const ref = db.collection('users').doc(uid).collection('chats').doc(entryId);
    botFirestoreLog('read owner chat entry', { uid: safeLogId(uid), entryId: safeLogId(entryId), chatId: safeLogId(pair.chatId) });
    const snap = await ref.get().catch(() => null);
    const existing = snap?.exists ? await openOwnChatEntry(senderChatPrivKey, entryId, snap.data()?.body).catch(() => null) : null;
    const entry = makeOwnChatEntry(pair, {
        peerUid: fields.peerUid || existing?.peerUid,
        actors: existing?.actors || {},
        settings: existing?.settings,
        preview: fields.preview || existing?.preview,
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
    botFirestoreLog('read chat message exists', { chatId: safeLogId(chatId), msgId: safeLogId(msgId) });
    const snap = await db.collection('chats').doc(chatId).collection('messages').doc(msgId).get();
    botFirestoreLog('read chat message exists done', { chatId: safeLogId(chatId), msgId: safeLogId(msgId), hit: snap.exists });
    return snap.exists;
}

export async function decryptBotMsg(msgData, userChatPK, userChatPrivKey, peerChatPK, options = {}) {
    if (!hasMsgData(msgData) || !userChatPK || !userChatPrivKey || !peerChatPK) {
        return null;
    }

    const pair = await getCachedBotPair(userChatPK, userChatPrivKey, peerChatPK, { chatId: options?.chatId });
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

    const updatePreview = options?.updatePreview !== false;
    const msgId = cleanText(options?.msgId);
    const pair = await resolveBotPair(db, FieldValue, senderChatPK, senderChatPrivKey, receiverChatPK, options);
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
    const recipientProfile = await recipientForSend(db, receiverChatPK, options, updatePreview);
    const ownerEntry = updatePreview
        ? await writeBotOwnerEntry(db, options?.senderUid, senderChatPrivKey, pair, {
              peerUid: recipientProfile?.uid,
              ts: msgTs,
              preview: {
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
    const ping = recipientProfile?.uid && updatePreview
        ? await sealPing(senderChatPK, senderChatPrivKey, receiverChatPK, {
              kind: 'message',
              chatId,
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
    if (ownerEntry) {
        batch.set(ownerEntry.ref, ownerEntry.data, { merge: true });
    }
    try {
        botFirestoreLog('write chat message batch', {
            chatId: safeLogId(chatId),
            msgId: safeLogId(msgRef.id),
            ownerEntry: Boolean(ownerEntry),
            ping: Boolean(ping),
        });
        await batch.commit();
        botFirestoreLog('write chat message batch done', { chatId: safeLogId(chatId), msgId: safeLogId(msgRef.id) });
    } catch (error) {
        if (msgId && isAlreadyExists(error)) {
            botFirestoreLog('write chat message skipped', { chatId: safeLogId(chatId), msgId: safeLogId(msgRef.id) });
            return { chatId, msgId, skipped: true };
        }
        throw error;
    }
    if (ping && typeof options?.sendPush === 'function') {
        botFirestoreLog('send inbox ping', { recipientUid: safeLogId(recipientProfile.uid), chatId: safeLogId(chatId), msgId: safeLogId(msgRef.id) });
        await options.sendPush(recipientProfile.uid, callablePing(ping));
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

    const pair = await getCachedBotPair(senderChatPK, senderChatPrivKey, receiverChatPK, { chatId });
    if (pair.chatId !== chatId) {
        throw new Error('chat mismatch');
    }
    const target = cleanText(newMessage?.cid) || cleanText(msgId);
    const op = newMessage?.t === 'req' && cleanText(newMessage?.tx) ? CHAT_ACTION_OPS.PAY_CONFIRM : CHAT_ACTION_OPS.EDIT;
    const { head, body } = await sealMsg(pair, { ...(newMessage || {}), cid: makeCid(), s: senderChatPK }, { op, target });
    const rawBody = adminBytes(body);
    botFirestoreLog('write chat action', { chatId: safeLogId(chatId), msgId: safeLogId(msgId), op, target: safeLogId(target) });
    await db.collection('chats').doc(chatId).collection('messages').doc().set({
        head,
        body: rawBody,
        ts: new Date(),
        ttl: null,
    });
    botFirestoreLog('write chat action done', { chatId: safeLogId(chatId), msgId: safeLogId(msgId), op });
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

export async function uploadBotAttachment(bucket, senderChatPK, senderChatPrivKey, receiverChatPK, attachment = {}, options = {}) {
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

    const pair = await getCachedBotPair(senderChatPK, senderChatPrivKey, receiverChatPK, { chatId: options?.chatId || attachment?.chatId || attachment?.meta?.chatId });
    return putBotAttachment(bucket, pair, cid, attachment?.type, attachment?.data, attachment?.meta || {});
}

export async function uploadBotAttachmentMsg(db, FieldValue, bucket, senderChatPK, senderChatPrivKey, receiverChatPK, attachment = {}, options = {}) {
    const cid = cleanText(attachment?.cid);
    if (!cid) {
        throw new Error('message cid required');
    }

    const pair = await resolveBotPair(db, FieldValue, senderChatPK, senderChatPrivKey, receiverChatPK, options);
    const msg = await putBotAttachment(bucket, pair, cid, attachment?.type, attachment?.data, attachment?.meta || {});
    return sendBotMsg(db, FieldValue, senderChatPK, senderChatPrivKey, receiverChatPK, { ...msg, cid }, { ...options, chatId: pair.chatId, linkId: pair.linkId });
}
