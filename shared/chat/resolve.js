'use client';

import { dropCachedMedia } from '../localdatacache.js';
import { canShowMsg, hasLocalFileRef, hasStoredFileRef, isAttachmentMsgType, isControlMsg, isExpiredAttachmentMsg } from './messages.js';
import { getMessageKey } from './state.js';

const DEFAULT_CONCURRENCY = 3;

function remoteAttachmentNeedsRead(message) {
    return isAttachmentMsgType(message?.t) && !message?.pending && !message?.failed && !hasLocalFileRef(message);
}

function ttlKey(ttl) {
    if (ttl == null) {
        return 'null';
    }
    if (typeof ttl?.toMillis === 'function') {
        return String(ttl.toMillis());
    }
    return String(ttl);
}

function attachmentResolutionKey(message) {
    if (!remoteAttachmentNeedsRead(message)) {
        return '';
    }
    const key = getMessageKey(message);
    if (!key || !message?.p || !message?.k) {
        return '';
    }
    return [key, message.t || '', message.p, message.k, message.x ?? '', ttlKey(message.ttl)].join('\n');
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

function dropMessageMedia(localCache, message) {
    if (!localCache || !message?.p || !message?.k) {
        return;
    }
    void dropCachedMedia(localCache, message).catch(() => {});
}

async function resolveOne(message, options) {
    const { droppedKeys, localCache, peerChatPK, readMessageFile, resolvedKeys } = options;
    const key = getMessageKey(message);
    if (key && droppedKeys?.has?.(key)) {
        return null;
    }

    if (isControlMsg(message)) {
        return message;
    }

    if (!canShowMsg(message)) {
        rememberDrop(droppedKeys, message);
        dropMessageMedia(localCache, message);
        return null;
    }

    if (!remoteAttachmentNeedsRead(message)) {
        return message;
    }

    const resolutionKey = attachmentResolutionKey(message);
    if (resolutionKey && resolvedKeys?.has?.(resolutionKey)) {
        return message;
    }

    if (shouldDropBeforeRead(message) || !peerChatPK || typeof readMessageFile !== 'function') {
        rememberDrop(droppedKeys, message);
        dropMessageMedia(localCache, message);
        return null;
    }

    try {
        const bytes = await readMessageFile(peerChatPK, message);
        if (bytes?.byteLength) {
            if (resolutionKey) {
                resolvedKeys?.add?.(resolutionKey);
            }
            return message;
        }
    } catch {}

    if (resolutionKey) {
        resolvedKeys?.delete?.(resolutionKey);
    }
    rememberDrop(droppedKeys, message);
    dropMessageMedia(localCache, message);
    return null;
}

export function hasRemoteAttachmentToResolve(messages) {
    return (messages || []).some((message) => remoteAttachmentNeedsRead(message));
}

export async function resolveRenderableMessages(messages, options = {}) {
    const input = Array.isArray(messages) ? messages : [];
    if (!input.length) {
        return [];
    }

    const concurrency = Math.max(1, Math.trunc(Number(options.concurrency) || DEFAULT_CONCURRENCY));
    const output = new Array(input.length);
    let index = 0;

    async function worker() {
        while (index < input.length) {
            const current = index;
            index += 1;
            output[current] = await resolveOne(input[current], options);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, input.length) }, () => worker()));
    return output.filter(Boolean);
}
