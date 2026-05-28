import { filterChatMessages } from '../../ids.js';
import { hasStoredFileRef, isExpiredAttachmentMsg } from '../../messages.js';

export function isRemoteMediaMessage(message, mediaConfig) {
    const path = typeof message?.p === 'string' ? message.p.trim() : '';
    const fileKey = typeof message?.k === 'string' ? message.k.trim() : '';
    if (!path || !fileKey || path.startsWith('local:') || fileKey === 'local' || message?.pending || message?.failed || isExpiredAttachmentMsg(message) || !hasStoredFileRef(message)) {
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

export function mediaKey(peerChatPK, message) {
    return `${peerChatPK || ''}:${message?.t || ''}:${message?.p || ''}:${message?.k || ''}`;
}

export function waitForIdle(delayMs) {
    return new Promise((resolve) => {
        if (typeof globalThis.requestIdleCallback === 'function') {
            globalThis.requestIdleCallback(() => resolve(), { timeout: Math.max(50, Number(delayMs) || 0) });
            return;
        }
        setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
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
            const key = mediaKey(entry.peerChatPK, message);
            if (!key || queued.has(key) || attempts?.has?.(key)) {
                continue;
            }
            queued.add(key);
            tasks.push({ key, message, peerChatPK: entry.peerChatPK, priority: chatIndex === 0 ? 3 : 1, rank: chatIndex * 1000 + messageIndex });
        }
    }
    return tasks.sort((a, b) => a.rank - b.rank);
}
