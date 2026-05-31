import { filterChatMessages } from '../../ids.js';
import { hasStoredFileRef, isExpiredAttachmentMsg, storedFileKey } from '../../messages.js';
import { IDLE_CALLBACK_MIN_TIMEOUT_MS } from '../../../config.js';
import { waitForIdle as waitForGlobalIdle } from '../../../utils/async.js';
import { nonNegativeNumber } from '../../../utils/number.js';

export function isRemoteMediaMessage(message, mediaConfig) {
    if (message?.pending || message?.failed || isExpiredAttachmentMsg(message) || !hasStoredFileRef(message)) {
        return false;
    }

    const type = String(message?.t || '');
    if (!mediaConfig.types.includes(type)) {
        return false;
    }

    const maxBytes = Number(mediaConfig.maxBytes);
    const size = Number(message?.z);
    return !(Number.isFinite(maxBytes) && maxBytes > 0 && Number.isFinite(size) && size > maxBytes);
}

export function waitForMediaIdle(delayMs) {
    const delay = nonNegativeNumber(delayMs, 0);
    return waitForGlobalIdle({
        timeout: Math.max(IDLE_CALLBACK_MIN_TIMEOUT_MS, delay),
        delay,
    });
}

export function getMediaTasks({ ids, batches, chatPK, mediaConfig, attempts }) {
    const tasks = [];
    const queued = new Set();
    for (const [chatIndex, chatId] of (ids || []).entries()) {
        const entry = batches?.get?.(chatId);
        if (!entry?.ready || !entry.exists || !entry.messages?.length || !entry.peerChatPK) {
            continue;
        }
        const messages = filterChatMessages(entry.messages, chatPK, entry.peerChatPK).slice().reverse().slice(0, mediaConfig.messagesPerChat);
        for (const [messageIndex, message] of messages.entries()) {
            if (!isRemoteMediaMessage(message, mediaConfig)) {
                continue;
            }
            const key = storedFileKey(entry.peerChatPK, message, { type: true });
            if (!key || queued.has(key) || attempts?.has?.(key)) {
                continue;
            }
            queued.add(key);
            tasks.push({ key, message, peerChatPK: entry.peerChatPK, priority: chatIndex === 0 ? 3 : 1, rank: chatIndex * 1000 + messageIndex });
        }
    }
    return tasks.sort((a, b) => a.rank - b.rank);
}
