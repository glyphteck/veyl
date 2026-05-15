'use client';

import { getChatId } from '../crypto/chat.js';
import { checkAttachmentSize, getAttachmentType, isAttachmentType, makeAttachmentUnavailableError } from './attachments.js';
import { makeTs, setLocalChats } from './chats.js';
import { makeCid, sortMessages } from './state.js';

export const LOCAL_FAILED = Object.freeze({ pending: false, failed: true });
export const LOCAL_PENDING = Object.freeze({ pending: true, failed: false });
export const LOCAL_SENT = Object.freeze({ pending: false, failed: false });

function replyPatch(message) {
    return typeof message?.r === 'string' && message.r ? { r: message.r } : {};
}

function patchCid(message, cid, patch) {
    if (!message?.cid || message.cid !== cid) {
        return message;
    }
    return {
        ...message,
        ...patch,
    };
}

export function makeLocalMessage(chatPK, peerChatPK, message) {
    const chatId = getChatId(chatPK, peerChatPK);
    const cid = message?.cid || makeCid();
    const ms = Date.now();
    const local = {
        ...message,
        s: message?.s || chatPK,
        from: chatPK,
        cid,
        id: `local:${cid}`,
        ts: makeTs(ms),
        pending: true,
        failed: false,
    };

    return { chatId, cid, local, ms };
}

export function addLocalMessage(localByChat, chatId, local) {
    const next = new Map(localByChat);
    const current = next.get(chatId) ?? [];
    next.set(chatId, sortMessages([...current.filter((item) => item.cid !== local.cid), local]));
    return next;
}

export function addLocalMessageToChats(chats, chatId, local, currentLocals = []) {
    return setLocalChats(chats, new Map([[chatId, sortMessages([local, ...currentLocals])]]));
}

export function updateLastChatWithLocal(current, peerChatPK, local, ms) {
    const currentMs = typeof current?.lastMsg?.ts?.toMillis === 'function' ? current.lastMsg.ts.toMillis() : 0;
    if (currentMs > ms) {
        return current;
    }
    return { lastMsg: local, peerChatPK };
}

export function patchLocalMessageMap(localByChat, chatId, cid, patch) {
    const current = localByChat.get(chatId);
    if (!current?.length) {
        return localByChat;
    }

    const next = new Map(localByChat);
    next.set(
        chatId,
        current.map((message) => patchCid(message, cid, patch))
    );
    return next;
}

export function patchChatLastMessage(chats, chatId, cid, patch) {
    return chats.map((chatItem) => {
        if (chatItem.id !== chatId) {
            return chatItem;
        }
        return {
            ...chatItem,
            lastMsg: patchCid(chatItem.lastMsg, cid, patch),
        };
    });
}

export function patchLastChatMessage(current, cid, patch) {
    if (!current?.lastMsg) {
        return current;
    }
    return {
        ...current,
        lastMsg: patchCid(current.lastMsg, cid, patch),
    };
}

export function makeSendCid(message) {
    return message?.cid || makeCid();
}

export function makeSendMessage(chatPK, message) {
    const cid = makeSendCid(message);
    return {
        cid,
        message: {
            ...message,
            s: message?.s || chatPK,
            cid,
        },
    };
}

export function makeLongTxtLocalMessage(chatPK, cid, attachment, message) {
    return {
        t: 'file',
        p: `local:${cid}`,
        k: 'local',
        m: attachment.mimeType,
        z: attachment.size,
        n: attachment.name,
        localData: attachment.data,
        cid,
        s: chatPK,
        ...replyPatch(message),
    };
}

export function makeSentLongTxtMessage(chatPK, cid, uploaded, message) {
    return {
        ...uploaded,
        cid,
        s: chatPK,
        ...replyPatch(message),
    };
}

function localUriForAttachment(attachment) {
    if (typeof attachment?.previewUri === 'string' && attachment.previewUri) {
        return attachment.previewUri;
    }
    if (typeof attachment?.localUri === 'string' && attachment.localUri) {
        return attachment.localUri;
    }
    return '';
}

export function prepareAttachment(chatPK, attachment) {
    const size = checkAttachmentSize(attachment);
    const type = getAttachmentType(attachment);
    if (type === 'mp4' && (!Number.isFinite(size) || size <= 0 || !attachment?.data)) {
        throw makeAttachmentUnavailableError(type);
    }

    const cid = makeCid();
    const localUri = localUriForAttachment(attachment);
    const nextAttachment = {
        cid,
        type,
        data: attachment?.data,
        meta: attachment,
    };
    const localMessage = {
        t: type,
        ...(isAttachmentType(type) ? { p: `local:${cid}`, k: 'local' } : {}),
        ...(attachment?.mimeType ? { m: attachment.mimeType } : {}),
        ...(Number.isFinite(attachment?.size) ? { z: attachment.size } : {}),
        ...(Number.isFinite(attachment?.width) ? { w: attachment.width } : {}),
        ...(Number.isFinite(attachment?.height) ? { h: attachment.height } : {}),
        ...(Number.isFinite(attachment?.duration) ? { d: attachment.duration } : {}),
        ...(typeof attachment?.caption === 'string' && attachment.caption.trim() ? { c: attachment.caption.trim() } : {}),
        ...(typeof attachment?.name === 'string' && attachment.name.trim() ? { n: attachment.name.trim() } : {}),
        ...((type === 'img' || type === 'mp3' || type === 'mp4') && localUri ? { localUri } : {}),
        ...(attachment?.data ? { localData: attachment.data } : {}),
        cid,
        s: chatPK,
    };

    return { cid, nextAttachment, localMessage };
}

export function splitRetryMessage(message) {
    const { id, ts, from, pending, failed, localUri, localData, ...payload } = message;
    return { localUri, localData, payload };
}

export function retryAttachmentMeta(message, localUri = '') {
    return {
        ...(message?.m ? { mimeType: message.m } : {}),
        ...(Number.isFinite(message?.z) ? { size: message.z } : {}),
        ...(Number.isFinite(message?.w) ? { width: message.w } : {}),
        ...(Number.isFinite(message?.h) ? { height: message.h } : {}),
        ...(Number.isFinite(message?.d) ? { duration: message.d } : {}),
        ...(typeof message?.c === 'string' && message.c.trim() ? { caption: message.c.trim() } : {}),
        ...(typeof message?.n === 'string' && message.n.trim() ? { name: message.n.trim() } : {}),
        ...(localUri ? { localUri } : {}),
    };
}
