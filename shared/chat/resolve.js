'use client';

import { canShowMsg, hasLocalFileRef, hasStoredFileRef, isAttachmentMsgType, isControlMsg, isExpiredAttachmentMsg } from './messages.js';
import { getMessageKey } from './state.js';

function remoteAttachmentNeedsRead(message) {
    return isAttachmentMsgType(message?.t) && !message?.pending && !message?.failed && !hasLocalFileRef(message);
}

function shouldDropBeforeRead(message) {
    if (!remoteAttachmentNeedsRead(message)) {
        return false;
    }
    return isExpiredAttachmentMsg(message) || !hasStoredFileRef(message);
}

function rememberDrop(droppedKeys, message) {
    const key = getMessageKey(message);
    if (key && droppedKeys?.add) {
        droppedKeys.add(key);
    }
}

function resolveOne(message, options) {
    const { droppedKeys, peerChatPK } = options;
    const key = getMessageKey(message);
    if (key && droppedKeys?.has?.(key)) {
        return null;
    }

    if (isControlMsg(message)) {
        return message;
    }

    if (!canShowMsg(message)) {
        rememberDrop(droppedKeys, message);
        return null;
    }

    if (!remoteAttachmentNeedsRead(message)) {
        return message;
    }

    if (shouldDropBeforeRead(message) || !peerChatPK) {
        rememberDrop(droppedKeys, message);
        return null;
    }

    return message;
}

export function hasRemoteAttachmentToResolve(messages) {
    return (messages || []).some((message) => remoteAttachmentNeedsRead(message));
}

export async function resolveRenderableMessages(messages, options = {}) {
    const input = Array.isArray(messages) ? messages : [];
    if (!input.length) {
        return [];
    }
    return input.map((message) => resolveOne(message, options)).filter(Boolean);
}
