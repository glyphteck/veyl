import { addMessageKeys, messageHasKey } from '../../messagekeys.js';
import { isExpiredMsg } from '../../messages.js';
import { getMessageKey } from '../../state.js';
import { ttlMillis } from '../../ttl.js';

export function getBatchPreviewKey(messages) {
    const last = messages?.length ? messages[messages.length - 1] : null;
    return getMessageKey(last);
}

export function isBatchFresh(entry) {
    return (
        !entry?.chatPreviewKey ||
        entry.batchKeys?.has?.(entry.chatPreviewKey) ||
        entry.expiredKeys?.has?.(entry.chatPreviewKey) ||
        entry.deletedKeys?.has?.(entry.chatPreviewKey) ||
        (entry.ready && !entry.hasOlder && !entry.hasMore)
    );
}

export function makeMessageSessionSnapshot(entry) {
    if (!entry) {
        return null;
    }
    return {
        chatId: entry.chatId,
        messages: entry.messages || [],
        olderThan: entry.olderThan ?? null,
        carry: entry.carry ?? null,
        hasOlder: !!entry.hasOlder,
        hasMore: !!entry.hasMore,
        ready: !!entry.ready,
        loading: !!entry.loading,
        exists: !!entry.exists,
        fromCache: false,
        chatPreviewKey: entry.chatPreviewKey ?? null,
        batchPreviewKey: entry.batchPreviewKey ?? null,
        expiredKeys: new Set(entry.expiredKeys || []),
        deletedKeys: new Set(entry.deletedKeys || []),
        generation: entry.generation,
        adoptable: !!entry.ready && isBatchFresh(entry),
    };
}

export function trimExpiredEntry(entry, now = Date.now()) {
    if (!entry?.messages?.length) {
        return [];
    }

    const messages = [];
    const expiredKeys = new Set(entry.expiredKeys || []);
    const expiredMessages = [];
    let changed = false;
    for (const message of entry.messages) {
        if (isExpiredMsg(message, now)) {
            addMessageKeys(expiredKeys, message);
            expiredMessages.push(message);
            changed = true;
        } else {
            messages.push(message);
        }
    }
    if (!changed) {
        return [];
    }

    entry.messages = messages;
    entry.expiredKeys = expiredKeys;
    entry.batchKeys = new Set(messages.map(getMessageKey).filter(Boolean));
    entry.batchPreviewKey = getBatchPreviewKey(messages);
    return expiredMessages;
}

export function removeEntryMessages(entry, messages) {
    if (!entry?.messages?.length) {
        return [];
    }
    const keys = new Set();
    for (const message of messages || []) {
        addMessageKeys(keys, message);
    }
    if (!keys.size) {
        return [];
    }

    const nextMessages = [];
    const expiredKeys = new Set(entry.expiredKeys || []);
    const removedMessages = [];
    let changed = false;
    for (const message of entry.messages) {
        if (messageHasKey(message, keys)) {
            addMessageKeys(expiredKeys, message);
            removedMessages.push(message);
            changed = true;
        } else {
            nextMessages.push(message);
        }
    }
    if (!changed) {
        return [];
    }

    entry.messages = nextMessages;
    entry.expiredKeys = expiredKeys;
    entry.batchKeys = new Set(nextMessages.map(getMessageKey).filter(Boolean));
    entry.batchPreviewKey = getBatchPreviewKey(nextMessages);
    return removedMessages;
}

export function nextTrimMs(entries, now = Date.now()) {
    let next = Infinity;
    for (const entry of entries || []) {
        if (entry?.route || !entry?.messages?.length) {
            continue;
        }
        for (const message of entry.messages) {
            const ms = ttlMillis(message?.ttl);
            if (ms != null && ms > now && ms < next) {
                next = ms;
            }
        }
    }
    return Number.isFinite(next) ? next : null;
}
