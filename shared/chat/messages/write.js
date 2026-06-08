import { sealMsg } from '../../crypto/chat.js';
import { putAttachment, putFile, putImg, putMp3, putMp4, readMsgFile } from '../media.js';
import { hasChatMediaFileRef, makeHiddenCheckpoint, makeReaction, makeReadReceipt, makeRetentionSystemMsg } from '../messages.js';
import { getCachedPair } from '../pairs.js';
import { makeOwnChatEntry, openOwnChatEntry, ownChatEntryId, sealOwnChatEntry } from '../entry.js';
import { sealPing } from '../ping.js';
import { getChatMediaFileRef, getMediaFileRef } from '../filepayload.js';
import { CHAT_ACTION_OPS, actionOpForPayload } from './actions.js';
import { makeCid } from '../state.js';
import { cleanChatRetention, newMessageTtlMs, withMessageRetention } from '../ttl.js';
import { CHAT_DELETE_WRITE_BATCH_SIZE } from '../../config.js';
import { cleanText } from '../../utils/text.js';
import { makeTimestamp, timestampMs } from '../../utils/time.js';

const DELETE_WRITE_BATCH_SIZE = CHAT_DELETE_WRITE_BATCH_SIZE;

function makeTtlMs(value) {
    if (value == null) {
        return null;
    }
    const ms = timestampMs(value, null, { positive: true });
    return ms == null ? null : ms;
}

function getMessageTtlMs(retention) {
    return makeTtlMs(newMessageTtlMs(retention));
}

async function profileByChatPK(cloud, chatPK) {
    if (!cloud || !chatPK) {
        return null;
    }
    const peer = await cloud.search.peer.byChatPK(chatPK).catch(() => null);
    if (!peer) {
        return null;
    }
    return {
        uid: cleanText(peer.uid),
        actorPK: cleanText(peer.actorPK),
    };
}

async function readOwnEntry(cloud, uid, chatPrivKey, entryId) {
    if (!cloud || !uid || !chatPrivKey || !entryId) {
        return null;
    }
    const record = await cloud.user.chats.read(uid, entryId).catch(() => null);
    if (!record) {
        return null;
    }
    return openOwnChatEntry(chatPrivKey, entryId, record.body).catch(() => null);
}

export async function setChatRead(cloud, uid, chatPrivKey, chatId, readMs) {
    const nextReadMs = timestampMs(readMs, null, { positive: true });
    if (!cloud || !uid || !chatPrivKey || !chatId || nextReadMs == null) {
        return false;
    }
    const entryId = ownChatEntryId(chatPrivKey, chatId);
    const entry = await readOwnEntry(cloud, uid, chatPrivKey, entryId);
    const currentReadMs = timestampMs(entry?.readMs, 0) ?? 0;
    if (!entry?.chatId || currentReadMs >= nextReadMs) {
        return false;
    }

    await cloud.user.chats.write(uid, entryId, {
        body: await sealOwnChatEntry(chatPrivKey, entryId, {
            ...entry,
            readMs: nextReadMs,
        }),
    });
    return true;
}

export async function setChatPreview(cloud, uid, chatPrivKey, chatId, preview = null) {
    if (!cloud || !uid || !chatPrivKey || !chatId) {
        return false;
    }
    const entryId = ownChatEntryId(chatPrivKey, chatId);
    const entry = await readOwnEntry(cloud, uid, chatPrivKey, entryId);
    if (!entry?.chatId) {
        return false;
    }

    const record = {
        body: await sealOwnChatEntry(chatPrivKey, entryId, {
            ...entry,
            preview: preview || null,
        }),
    };

    await cloud.user.chats.write(uid, entryId, record);
    return true;
}

async function ownEntryWrite(cloud, uid, chatPrivKey, pair, fields = {}) {
    if (!cloud || !uid || !chatPrivKey || !pair?.chatId) {
        return null;
    }
    const entryId = ownChatEntryId(chatPrivKey, pair.chatId);
    const existing = fields.entry || await readOwnEntry(cloud, uid, chatPrivKey, entryId);
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
        preview: fields.preview || existing?.preview,
        saved: existing?.saved || null,
        readMs: existing?.readMs,
    });
    const tsMs = timestampMs(fields.ts, null);
    return {
        uid,
        entryId,
        record: {
            body: await sealOwnChatEntry(chatPrivKey, entryId, entry),
            ...(Number.isFinite(tsMs) ? { tsMs } : { touchTs: true }),
        },
    };
}

function ownerPreview(senderPubkey, message, messageId, head, tsMs, ttlMs) {
    const ttl = Number.isFinite(ttlMs) ? makeTimestamp(ttlMs) : null;
    return {
        ...(message || {}),
        s: senderPubkey,
        from: senderPubkey,
        cid: head.cid,
        id: messageId,
        ts: makeTimestamp(tsMs),
        ttl,
        pending: false,
        failed: false,
    };
}

function ownerEditedPreview(senderPubkey, message) {
    return {
        ...(message || {}),
        s: senderPubkey,
        from: senderPubkey,
        pending: false,
        failed: false,
    };
}

function messageFileChatId(message) {
    try {
        const ref = getMediaFileRef(message?.p);
        return ref?.type === 'chat' ? ref.chatId : '';
    } catch {
        return '';
    }
}

async function recipientForSend(cloud, receiverChatPK, options, needed) {
    if (!needed) {
        return null;
    }
    const uid = cleanText(options?.receiverUid);
    const actorPK = cleanText(options?.peerActorPK);
    if (uid) {
        return { uid, actorPK };
    }
    return profileByChatPK(cloud, receiverChatPK);
}

export async function sendMsg(cloud, senderPubkey, senderPrivkey, receiverChatPK, message, options = {}) {
    if (!senderPrivkey || !senderPubkey) {
        throw new Error('vault locked');
    }
    const updatePreview = options?.updatePreview !== false;
    const chatId = cleanText(options?.chatId);
    if (!chatId) {
        throw new Error('chat id required');
    }
    const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK, { chatId });
    if (options?.linkId && cleanText(options.linkId) !== pair.linkId) {
        throw new Error('link mismatch');
    }
    const retention = cleanChatRetention(options?.retention ?? options?.ttlMode);
    const tsMs = Date.now();
    const messagePayload = withMessageRetention(message, retention);
    const actionOp = actionOpForPayload(messagePayload);
    const { head, body } = await sealMsg(pair, messagePayload, { op: actionOp, ts: tsMs });
    const ttlMs = actionOp === CHAT_ACTION_OPS.CREATE ? getMessageTtlMs(retention) : null;
    const messageId = cleanText(options?.messageId) || await cloud.chat.messages.id(chatId);
    const msgData = {
        head,
        body,
        ttlMs,
    };

    const recipientProfile = await recipientForSend(cloud, receiverChatPK, options, updatePreview || options?.ping === true);
    const preview = updatePreview ? ownerPreview(senderPubkey, messagePayload, messageId, head, tsMs, ttlMs) : null;
    const ownerEntry = updatePreview
        ? await ownEntryWrite(cloud, cleanText(options?.senderUid), senderPrivkey, pair, {
              peerUid: recipientProfile?.uid || cleanText(options?.receiverUid),
              peerActorPK: recipientProfile?.actorPK,
              entry: options?.ownEntry,
              preview,
              ts: tsMs,
          })
        : null;
    const ping =
        recipientProfile?.uid && (updatePreview || options?.ping === true)
            ? await sealPing(senderPubkey, senderPrivkey, receiverChatPK, {
                  kind: updatePreview ? 'message' : 'ping',
                  chatId,
                  senderUid: cleanText(options?.senderUid),
                  messageId,
                  ts: tsMs,
              })
            : null;

    await cloud.chat.messages.send({
        chatId,
        messageId,
        message: msgData,
        ownerEntry,
        inbox: ping ? { recipientUid: recipientProfile?.uid, ping } : null,
    });
    return { chatId, msgId: messageId, cid: head.cid, preview };
}

export async function sendReadReceipt(cloud, senderPubkey, senderPrivkey, receiverChatPK, target, options = {}) {
    const receipt = {
        ...makeReadReceipt(target),
        cid: makeCid(),
        s: senderPubkey,
    };
    return sendMsg(cloud, senderPubkey, senderPrivkey, receiverChatPK, receipt, { updatePreview: false, ...options });
}

export async function sendReaction(cloud, senderPubkey, senderPrivkey, receiverChatPK, target, emoji, options = {}) {
    const reaction = {
        ...makeReaction(target, emoji),
        cid: makeCid(),
        s: senderPubkey,
    };
    return sendMsg(cloud, senderPubkey, senderPrivkey, receiverChatPK, reaction, { updatePreview: false, ...options });
}

export async function sendHiddenCheckpoint(cloud, senderPubkey, senderPrivkey, receiverChatPK, target, options = {}) {
    const checkpoint = {
        ...makeHiddenCheckpoint(target),
        cid: makeCid(),
        s: senderPubkey,
    };
    return sendMsg(cloud, senderPubkey, senderPrivkey, receiverChatPK, checkpoint, { updatePreview: false, ...options });
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
        const mediaRef = !stringMessage && hasChatMediaFileRef(message) ? getChatMediaFileRef(message.p) : null;
        items.push({
            id,
            cid: cleanText(message?.cid),
            mediaKey: mediaRef?.mediaId || '',
            mediaPath: mediaRef ? cleanText(message.p) : '',
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

export async function makeMsgTemporary(cloud, chatId, messages, ttlMs = newMessageTtlMs()) {
    const nextTtlMs = makeTtlMs(ttlMs);
    const items = messageTemporaryUpdateItems(messages);
    if (!cloud || !chatId || !nextTtlMs || !items.length) {
        return 0;
    }
    if (typeof cloud.chat?.messages?.ttl !== 'function') {
        throw new Error('message ttl unavailable');
    }
    const result = await cloud.chat.messages.ttl(chatId, items, { permanent: false, ttlMs: nextTtlMs });
    return Number.isFinite(result?.updated) ? result.updated : items.length;
}

export async function makeMsgPermanent(cloud, chatId, messages) {
    const items = messagePermanentUpdateItems(messages);
    if (!cloud || !chatId || !items.length) {
        return 0;
    }
    if (typeof cloud.chat?.messages?.ttl !== 'function') {
        throw new Error('message ttl unavailable');
    }
    const result = await cloud.chat.messages.ttl(chatId, items, { permanent: true });
    return Number.isFinite(result?.updated) ? result.updated : items.length;
}

export async function setChatRetention(cloud, chatId, senderPubkey, senderPrivkey, peerChatPK, retention, options = {}) {
    if (!senderPubkey || !senderPrivkey || !peerChatPK) {
        throw new Error('vault locked');
    }
    const nextRetention = cleanChatRetention(retention);
    const pair = await getCachedPair(senderPubkey, senderPrivkey, peerChatPK, { chatId });
    if (chatId && pair.chatId !== chatId) {
        throw new Error('chat mismatch');
    }
    const systemMessage = {
        ...makeRetentionSystemMsg(nextRetention),
        cid: makeCid(),
        s: senderPubkey,
    };
    const ownerEntry = await ownEntryWrite(cloud, cleanText(options?.senderUid), senderPrivkey, pair, { settings: { retention: nextRetention }, entry: options?.ownEntry });
    if (ownerEntry) {
        await cloud.user.chats.write(ownerEntry.uid, ownerEntry.entryId, ownerEntry.record);
    }
    await sendMsg(cloud, senderPubkey, senderPrivkey, peerChatPK, systemMessage, {
        chatId,
        linkId: pair.linkId,
        updatePreview: false,
        retention: nextRetention,
        chatExists: true,
        senderUid: options?.senderUid,
    });
    return nextRetention;
}

export async function uploadImgMsg(_cloud, senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsg(_cloud, senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'img',
        data,
        meta,
    });
}

export async function uploadMp3Msg(_cloud, senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsg(_cloud, senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'mp3',
        data,
        meta,
    });
}

export async function uploadMp4Msg(_cloud, senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsg(_cloud, senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'mp4',
        data,
        meta,
    });
}

export async function uploadFileMsg(_cloud, senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsg(_cloud, senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'file',
        data,
        meta,
    });
}

export async function uploadAttachmentMsg(_cloud, senderPubkey, senderPrivkey, receiverChatPK, attachment = {}) {
    if (!senderPrivkey || !senderPubkey) {
        throw new Error('vault locked');
    }

    const nextCid = cleanText(attachment?.cid);
    if (!nextCid) {
        throw new Error('message cid required');
    }

    const chatId = cleanText(attachment?.chatId || attachment?.meta?.chatId);
    if (!chatId) {
        throw new Error('chat id required');
    }
    const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK, { chatId });
    const type = cleanText(attachment?.type) || 'file';
    const data = attachment?.data;
    const meta = attachment?.meta || {};

    switch (type) {
        case 'img':
            return putImg(pair, nextCid, data, meta);
        case 'mp3':
            return putMp3(pair, nextCid, data, meta);
        case 'mp4':
            return putMp4(pair, nextCid, data, meta);
        case 'file':
            return putFile(pair, nextCid, data, meta);
        default:
            return putAttachment(pair, nextCid, type, data, meta);
    }
}

export async function updateMsg(cloud, chatId, msgId, senderPubkey, senderPrivkey, receiverChatPK, newMessage, options = {}) {
    if (!senderPubkey || !senderPrivkey) throw new Error('vault locked');
    const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK, { chatId });
    if (pair.chatId !== chatId) {
        throw new Error('chat mismatch');
    }
    const target = cleanText(newMessage?.cid) || cleanText(msgId);
    if (!target) {
        throw new Error('message target required');
    }
    const op = newMessage?.t === 'req' && cleanText(newMessage?.tx) ? CHAT_ACTION_OPS.PAY_CONFIRM : CHAT_ACTION_OPS.EDIT;
    const tsMs = Date.now();
    const action = {
        ...(newMessage || {}),
        cid: makeCid(),
        s: senderPubkey,
    };
    const { head, body } = await sealMsg(pair, action, { op, target, ts: tsMs });
    const messageId = cleanText(options?.messageId) || await cloud.chat.messages.id(chatId);
    const updatePreview = options?.updatePreview === true;
    const preview = updatePreview ? ownerEditedPreview(senderPubkey, newMessage) : null;
    const ownerEntry = updatePreview
        ? await ownEntryWrite(cloud, cleanText(options?.senderUid), senderPrivkey, pair, {
              peerUid: cleanText(options?.receiverUid),
              peerActorPK: cleanText(options?.peerActorPK),
              entry: options?.ownEntry,
              preview,
              ts: preview?.ts ?? tsMs,
          })
        : null;

    await cloud.chat.messages.send({
        chatId,
        messageId,
        message: {
            head,
            body,
            ttlMs: null,
        },
        ownerEntry,
        inbox: null,
    });
    return {
        chatId,
        msgId: messageId,
        cid: head.cid,
        preview,
    };
}

export async function deleteMsg(cloud, chatId, messageOrId, senderPubkey, senderPrivkey, peerChatPK, options = {}) {
    if (!cloud || !chatId || !messageOrId || !senderPubkey || !senderPrivkey || !peerChatPK) {
        return false;
    }
    const pair = await getCachedPair(senderPubkey, senderPrivkey, peerChatPK, { chatId });
    if (pair.chatId !== chatId) {
        return false;
    }
    const item = messageDeleteItems([messageOrId])[0];
    const target = cleanText(options?.docId) || cleanText(item?.id);
    if (!target || target.startsWith('local:')) {
        return false;
    }
    await cloud.chat.messages.delete(chatId, target, {
        mediaPaths: item?.mediaPath ? [item.mediaPath] : [],
    });
    return true;
}

export async function deleteMsgs(cloud, chatId, messages, senderPubkey, senderPrivkey, peerChatPK) {
    if (!cloud || !chatId || !senderPubkey || !senderPrivkey || !peerChatPK) {
        return 0;
    }

    const items = messageDeleteItems(messages);
    if (!items.length) {
        return 0;
    }
    const pair = await getCachedPair(senderPubkey, senderPrivkey, peerChatPK, { chatId });
    if (pair.chatId !== chatId) {
        return 0;
    }
    let deleted = 0;
    for (let index = 0; index < items.length; index += DELETE_WRITE_BATCH_SIZE) {
        const chunk = items.slice(index, index + DELETE_WRITE_BATCH_SIZE);
        const targets = chunk.map((item) => cleanText(item.id)).filter((target) => target && !target.startsWith('local:'));
        const mediaPaths = chunk.map((item) => cleanText(item.mediaPath)).filter(Boolean);
        deleted += await cloud.chat.messages.deleteMany(chatId, targets, { mediaPaths });
    }

    return deleted;
}

export async function readMsgMedia(readChatMedia, userChatPK, userPrivKey, peerChatPK, msg) {
    return readMsgAttachment(readChatMedia, userChatPK, userPrivKey, peerChatPK, msg);
}

export async function readMsgAttachment(readChatMedia, userChatPK, userPrivKey, peerChatPK, msg) {
    if (typeof readChatMedia !== 'function') {
        throw new Error('chat media read required');
    }
    if (!userChatPK || !userPrivKey || !peerChatPK || !msg) {
        return null;
    }

    const pair = await getCachedPair(userChatPK, userPrivKey, peerChatPK, { chatId: msg?.chatId || messageFileChatId(msg) });
    return readMsgFile(readChatMedia, pair, msg);
}
