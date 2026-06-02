import { collection, doc, getDocFromServer, getDocsFromServer, limit, query, serverTimestamp, setDoc, Timestamp, where, writeBatch } from 'firebase/firestore';
import { sealMsg } from '../../crypto/chat.js';
import { putAttachment, putFile, putImg, putMp3, putMp4, readMsgFile } from '../media.js';
import { makeHiddenCheckpoint, makeReaction, makeReadReceipt, makeRetentionSystemMsg } from '../messages.js';
import { getCachedPair } from '../pairs.js';
import { makeOwnChatEntry, openOwnChatEntry, ownChatEntryId, sealChatWake, sealOwnChatEntry } from '../entries.js';
import { CHAT_ACTION_OPS } from './actions.js';
import { makeCid } from '../state.js';
import { cleanChatRetention, newMessageTtlMs, withMessageRetention } from '../ttl.js';
import { CHAT_DELETE_WRITE_BATCH_SIZE } from '../../config.js';
import { cleanText } from '../../utils/text.js';
import { timestampMs } from '../../utils/time.js';

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

export async function syncChatLastMsg(db, chatId, lastMsg) {
    return !!(db && chatId && lastMsg);
}

async function profileByChatPK(db, chatPK) {
    if (!db || !chatPK) {
        return null;
    }
    const snap = await getDocsFromServer(query(collection(db, 'profiles'), where('chatPK', '==', chatPK), limit(1))).catch(() => null);
    const docSnap = snap?.docs?.[0] ?? null;
    if (!docSnap) {
        return null;
    }
    const data = docSnap.data() || {};
    return {
        uid: cleanText(data.uid) || docSnap.id,
        actorPK: cleanText(data.actorPK),
    };
}

async function readOwnEntry(db, uid, chatPrivKey, entryId) {
    if (!db || !uid || !chatPrivKey || !entryId) {
        return null;
    }
    const snap = await getDocFromServer(doc(db, 'users', uid, 'chats', entryId)).catch(() => null);
    if (!snap?.exists?.()) {
        return null;
    }
    return openOwnChatEntry(chatPrivKey, entryId, snap.data()?.body).catch(() => null);
}

async function ownEntryWrite(db, uid, chatPrivKey, pair, fields = {}) {
    if (!db || !uid || !chatPrivKey || !pair?.chatId) {
        return null;
    }
    const entryId = ownChatEntryId(chatPrivKey, pair.chatId);
    const existing = await readOwnEntry(db, uid, chatPrivKey, entryId);
    const peerActorPK = cleanText(fields.peerActorPK) || cleanText(existing?.actors?.[pair.peerChatPK]);
    const actors = {
        ...(existing?.actors || {}),
        [pair.chatPK]: pair.actor.publicKey,
        ...(peerActorPK ? { [pair.peerChatPK]: peerActorPK } : {}),
    };
    const entry = makeOwnChatEntry(pair, {
        peerUid: fields.peerUid || existing?.peerUid,
        peerActorPK,
        actors,
        settings: fields.settings || existing?.settings,
        lastMsg: fields.lastMsg || existing?.lastMsg,
        saved: existing?.saved || null,
        readMs: existing?.readMs,
    });
    return {
        ref: doc(db, 'users', uid, 'chats', entryId),
        data: {
            body: await sealOwnChatEntry(chatPrivKey, entryId, entry),
            ts: fields.ts || makeTtlTimestamp(fields.lastMsg?.ts) || serverTimestamp(),
        },
    };
}

function ownerLastMsg(senderPubkey, message, msgRef, head, tsMs, ttl) {
    return {
        ...(message || {}),
        s: senderPubkey,
        from: senderPubkey,
        cid: head.cid,
        id: msgRef.id,
        ts: Timestamp.fromMillis(tsMs),
        ttl,
        pending: false,
        failed: false,
    };
}

export async function sendMsg(db, senderPubkey, senderPrivkey, receiverChatPK, message, options = {}) {
    if (!senderPrivkey || !senderPubkey) {
        throw new Error('vault locked');
    }
    const updateLastMsg = options?.updateLastMsg !== false;
    const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK);
    const chatId = pair.chatId;
    const retention = cleanChatRetention(options?.retention ?? options?.ttlMode);
    const tsMs = Date.now();
    const messagePayload = withMessageRetention(message, retention);
    const { head, body } = await sealMsg(pair, messagePayload, { ts: tsMs });
    const chatRef = doc(db, 'chats', chatId);
    const ttl = getMessageTtl(retention);
    const msgData = {
        head,
        body,
        ts: serverTimestamp(),
        ttl,
    };

    const recipientProfile = updateLastMsg || options?.wake === true ? await profileByChatPK(db, receiverChatPK) : null;
    const lastMsg = updateLastMsg ? ownerLastMsg(senderPubkey, messagePayload, doc(collection(chatRef, 'messages')), head, tsMs, ttl) : null;
    const msgRef = lastMsg?.id ? doc(db, 'chats', chatId, 'messages', lastMsg.id) : doc(collection(chatRef, 'messages'));
    if (lastMsg) {
        lastMsg.id = msgRef.id;
    }
    const ownerEntry = updateLastMsg
        ? await ownEntryWrite(db, cleanText(options?.senderUid), senderPrivkey, pair, {
              peerUid: recipientProfile?.uid || cleanText(options?.receiverUid),
              peerActorPK: recipientProfile?.actorPK,
              lastMsg,
              ts: lastMsg?.ts,
          })
        : null;
    const wake =
        recipientProfile?.uid && (updateLastMsg || options?.wake === true)
            ? await sealChatWake(senderPubkey, senderPrivkey, receiverChatPK, {
                  kind: updateLastMsg ? 'message' : 'wake',
                  senderUid: cleanText(options?.senderUid),
                  messageId: msgRef.id,
                  ts: tsMs,
              })
            : null;

    const batch = writeBatch(db);
    batch.set(chatRef, { v: 1, ts: serverTimestamp() }, { merge: true });
    batch.set(msgRef, msgData);
    if (ownerEntry) {
        batch.set(ownerEntry.ref, ownerEntry.data, { merge: true });
    }
    if (wake) {
        batch.set(doc(collection(db, 'users', recipientProfile.uid, 'chatInbox')), {
            ...wake,
            ts: serverTimestamp(),
        });
    }
    await batch.commit();
    return { chatId, msgId: msgRef.id, cid: head.cid, lastMsg };
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
    return db && chatId && makeTtlTimestamp(ttlMs) ? messageTemporaryUpdateItems(messages).length : 0;
}

export async function makeMsgPermanent(db, chatId, messages) {
    return db && chatId ? messagePermanentUpdateItems(messages).length : 0;
}

export async function setChatRetention(db, chatId, senderPubkey, senderPrivkey, peerChatPK, retention, options = {}) {
    if (!senderPubkey || !senderPrivkey || !peerChatPK) {
        throw new Error('vault locked');
    }
    const nextRetention = cleanChatRetention(retention);
    const pair = await getCachedPair(senderPubkey, senderPrivkey, peerChatPK);
    if (chatId && pair.chatId !== chatId) {
        throw new Error('chat mismatch');
    }
    const systemMessage = {
        ...makeRetentionSystemMsg(nextRetention),
        cid: makeCid(),
        s: senderPubkey,
    };
    await ownEntryWrite(db, cleanText(options?.senderUid), senderPrivkey, pair, { settings: { retention: nextRetention } }).then((entry) => (entry ? setDoc(entry.ref, entry.data, { merge: true }) : null));
    await sendMsg(db, senderPubkey, senderPrivkey, peerChatPK, systemMessage, {
        updateLastMsg: false,
        retention: nextRetention,
        chatExists: true,
        senderUid: options?.senderUid,
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

export async function updateMsg(db, chatId, msgId, senderPubkey, senderPrivkey, receiverChatPK, newMessage, options = {}) {
    if (!senderPubkey || !senderPrivkey) throw new Error('vault locked');
    const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK);
    if (pair.chatId !== chatId) {
        throw new Error('chat mismatch');
    }
    const target = cleanText(newMessage?.cid) || cleanText(msgId);
    if (!target) {
        throw new Error('message target required');
    }
    const op = newMessage?.t === 'req' && cleanText(newMessage?.tx) ? CHAT_ACTION_OPS.PAY_CONFIRM : CHAT_ACTION_OPS.EDIT;
    const action = {
        ...(newMessage || {}),
        cid: makeCid(),
        s: senderPubkey,
    };
    const { head, body } = await sealMsg(pair, action, { op, target });
    await setDoc(doc(collection(db, 'chats', chatId, 'messages')), {
        head,
        body,
        ts: serverTimestamp(),
        ttl: null,
    });
}

export async function deleteMsg(db, chatId, msgId, senderPubkey, senderPrivkey, peerChatPK, options = {}) {
    if (!db || !chatId || !msgId || !senderPubkey || !senderPrivkey || !peerChatPK) {
        return false;
    }
    const pair = await getCachedPair(senderPubkey, senderPrivkey, peerChatPK);
    if (pair.chatId !== chatId) {
        return false;
    }
    const target = cleanText(options?.target) || cleanText(msgId);
    const { head, body } = await sealMsg(pair, { t: 'del', cid: makeCid(), target, s: senderPubkey }, { op: CHAT_ACTION_OPS.DELETE, target, auth: true });
    await setDoc(doc(collection(db, 'chats', chatId, 'messages')), {
        head,
        body,
        ts: serverTimestamp(),
        ttl: null,
    });
    return true;
}

export async function deleteMsgs(db, chatId, messages, senderPubkey, senderPrivkey, peerChatPK, options = {}) {
    if (!db || !chatId || !senderPubkey || !senderPrivkey || !peerChatPK) {
        return 0;
    }

    const items = messageDeleteItems(messages);
    if (!items.length) {
        return 0;
    }
    const pair = await getCachedPair(senderPubkey, senderPrivkey, peerChatPK);
    if (pair.chatId !== chatId) {
        return 0;
    }
    for (let index = 0; index < items.length; index += DELETE_WRITE_BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = items.slice(index, index + DELETE_WRITE_BATCH_SIZE);
        for (const item of chunk) {
            const target = cleanText(item.cid) || cleanText(item.id);
            const { head, body } = await sealMsg(pair, { t: 'del', cid: makeCid(), target, s: senderPubkey }, { op: CHAT_ACTION_OPS.DELETE, target, auth: true });
            batch.set(doc(collection(db, 'chats', chatId, 'messages')), {
                head,
                body,
                ts: serverTimestamp(),
                ttl: null,
            });
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
