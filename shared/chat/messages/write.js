import { collection, doc, serverTimestamp, updateDoc, writeBatch, getDoc, getDocFromServer, deleteField, Timestamp } from 'firebase/firestore';
import { getChatId, resealMsgBody, sealMsg } from '../../crypto/chat.js';
import { orderChatKeys } from '../../crypto/pair.js';
import { putAttachment, putFile, putImg, putMp3, putMp4, readMsgFile } from '../media.js';
import { makeHiddenCheckpoint, makeReaction, makeReadReceipt, makeRetentionSystemMsg } from '../messages.js';
import { sealChatSettingsForPair } from '../settings.js';
import { getOwnChatPKFromChatId } from '../ids.js';
import { getCachedPair } from '../pairs.js';
import { makeChatLastMsg, makeUpdatedChatLastMsg } from '../lastmsg.js';
import { makeCid } from '../state.js';
import { cleanChatRetention, newMessageTtlMs, withMessageRetention } from '../ttl.js';
import { CHAT_DELETE_WRITE_BATCH_SIZE, CHAT_TTL_WRITE_BATCH_SIZE } from '../../config.js';
import { cleanText } from '../../utils/text.js';
import { timestampMs } from '../../utils/time.js';

const TTL_WRITE_BATCH_SIZE = CHAT_TTL_WRITE_BATCH_SIZE;
const DELETE_WRITE_BATCH_SIZE = CHAT_DELETE_WRITE_BATCH_SIZE;

function makeTtlTimestamp(value) {
    if (value == null) {
        return null;
    }
    if (typeof value?.toMillis === 'function') {
        return value;
    }
    const ms = timestampMs(value, null, { positive: true });
    return ms == null ? null : Timestamp.fromMillis(ms);
}

function getMessageTtl(retention) {
    return makeTtlTimestamp(newMessageTtlMs(retention));
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

export async function sendHiddenCheckpoint(db, senderPubkey, senderPrivkey, receiverChatPK, target, options = {}) {
    const checkpoint = {
        ...makeHiddenCheckpoint(target),
        cid: makeCid(),
        s: senderPubkey,
    };
    return sendMsg(db, senderPubkey, senderPrivkey, receiverChatPK, checkpoint, { updateLastMsg: false, ...options });
}

function messageMutationItems(messages, { allowString = false, include = () => true } = {}) {
    const seen = new Set();
    const list = Array.isArray(messages) ? messages : [messages];
    const items = [];
    for (const message of list || []) {
        const stringMessage = typeof message === 'string';
        const id = stringMessage ? (allowString ? cleanText(message) : '') : cleanText(message?.id);
        if (!id || id.startsWith('local:') || seen.has(id) || message?.pending || message?.failed || !include(message)) {
            continue;
        }
        seen.add(id);
        items.push({
            id,
            cid: cleanText(message?.cid),
        });
    }
    return items;
}

function messageDeleteItems(messages) {
    return messageMutationItems(messages, { allowString: true });
}

function messagePermanentUpdateItems(messages) {
    return messageMutationItems(messages, { include: (message) => message?.ttl != null });
}

function messageTemporaryUpdateItems(messages) {
    return messageMutationItems(messages, { include: (message) => message?.ttl == null });
}

export async function makeMsgTemporary(db, chatId, messages, ttlMs = newMessageTtlMs()) {
    if (!db || !chatId) {
        return 0;
    }

    const ttl = makeTtlTimestamp(ttlMs);
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

    const nextCid = cleanText(attachment?.cid);
    if (!nextCid) {
        throw new Error('message cid required');
    }

    const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK);
    const type = cleanText(attachment?.type) || 'file';
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
    await updateDoc(msgRef, { body });

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
    batch.delete(msgRef);

    if (syncLastMsg) {
        batch.update(chatRef, { lastMsg: deleteField() });
    }

    await batch.commit();
    return true;
}

export async function deleteMsgs(db, chatId, messages) {
    if (!db || !chatId) {
        return 0;
    }

    const items = messageDeleteItems(messages);
    if (!items.length) {
        return 0;
    }

    const chatRef = doc(db, 'chats', chatId);
    const lastMsg = chatLastMsg(await getServerSnap(chatRef));
    const lastCid = chatLastCid(lastMsg);
    const updateLastMsg = !!lastCid && items.some((item) => item.cid && item.cid === lastCid);
    let lastMsgUpdated = false;

    for (let index = 0; index < items.length; index += DELETE_WRITE_BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = items.slice(index, index + DELETE_WRITE_BATCH_SIZE);
        for (const item of chunk) {
            batch.delete(doc(db, 'chats', chatId, 'messages', item.id));
        }
        if (updateLastMsg && !lastMsgUpdated) {
            batch.update(chatRef, { lastMsg: deleteField() });
            lastMsgUpdated = true;
        }
        await batch.commit();
    }

    return items.length;
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
