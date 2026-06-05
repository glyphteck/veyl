import { dropCachedMedia } from '../../cache/localdata.js';
import { filterChatMessages } from '../ids.js';
import { addMessageKeys, keySet, messageHasKey } from '../messagekeys.js';
import { getMessageKey, getMessageOrderMs, mergeMessages } from '../state.js';
import { holdVisibleMsg, isExpiredMsg } from './control.js';

export function trimExpiredMessages(messages, options = {}) {
    const keepKeys = options.keepKeys;
    const expiredKeys = options.expiredKeys;
    return (messages || []).filter((message) => {
        if (!isExpiredMsg(message)) {
            return true;
        }
        if (messageHasKey(message, keepKeys)) {
            addMessageKeys(expiredKeys, message);
        }
        return false;
    });
}

export function getMessagesBatch(messages, expiredKeys, deletedKeys) {
    if (!messages?.length) {
        return null;
    }

    const firstMs = getMessageOrderMs(messages[0]);
    const lastMs = getMessageOrderMs(messages[messages.length - 1]);
    if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) {
        return null;
    }
    return { firstMs, lastMs, expiredKeys: keySet(expiredKeys), deletedKeys: keySet(deletedKeys) };
}

export function isMissingFromBatch(message, msgBatch, keys) {
    if (!msgBatch || !message) {
        return false;
    }
    if (messageHasKey(message, msgBatch.expiredKeys)) {
        return false;
    }

    const key = getMessageKey(message);
    if (!key || keys.has(key)) {
        return false;
    }

    const ms = getMessageOrderMs(message);
    return Number.isFinite(ms) && ms >= msgBatch.firstMs && ms <= msgBatch.lastMs;
}

export function dropMissingFromBatch(messages, msgBatch, keys) {
    if (!msgBatch) {
        return messages || [];
    }
    return (messages || []).filter((message) => !isMissingFromBatch(message, msgBatch, keys));
}

export function removeMessagesByKeys(messages, keys) {
    if (!keys?.size) {
        return messages || [];
    }
    return (messages || []).filter((message) => !messageHasKey(message, keys));
}

export function expireMessageView(updateMessageView, scopeKey, messages) {
    if (typeof updateMessageView !== 'function') {
        return;
    }
    updateMessageView(scopeKey, (seed) => {
        if (!seed?.ready || !messages?.length) {
            return seed;
        }

        const keys = new Set();
        const expiredKeys = keySet(seed.serverBatch?.expiredKeys);
        const deletedKeys = keySet(seed.serverBatch?.deletedKeys);
        for (const message of messages) {
            addMessageKeys(keys, message);
            addMessageKeys(expiredKeys, message);
        }
        if (!keys.size) {
            return seed;
        }

        const older = removeMessagesByKeys(seed.older, keys);
        const live = removeMessagesByKeys(seed.live, keys);
        return {
            ...seed,
            older,
            live,
            serverBatch: live.length ? getMessagesBatch(live, expiredKeys, deletedKeys) : seed.serverBatch?.empty ? { empty: true, expiredKeys, deletedKeys } : { ...(seed.serverBatch || {}), expiredKeys, deletedKeys },
        };
    });
}

export function holdCurrentLiveMessages(previous, next, firstMs, nextKeys, expiredKeys, deletedKeys) {
    const current = next || [];
    if (!previous?.length) {
        return current;
    }

    const held = [];
    for (const message of previous) {
        const key = getMessageKey(message);
        const ms = getMessageOrderMs(message);
        if (!key || nextKeys.has(key)) {
            continue;
        }
        if (messageHasKey(message, deletedKeys)) {
            continue;
        }
        if (messageHasKey(message, expiredKeys)) {
            held.push(holdVisibleMsg(message));
            continue;
        }
        if (current.length && Number.isFinite(ms) && ms >= firstMs) {
            held.push(message);
        }
    }
    return held.length ? mergeMessages(current, held) : current;
}

export function dropMessageMedia(cache, message) {
    if (!cache || !message?.p || !message?.k) {
        return;
    }
    void dropCachedMedia(cache, message).catch(() => {});
}

export function messageSeedFromBatch(msgBatch, chatPK, peerChatPK) {
    if (!msgBatch) {
        return null;
    }

    if (msgBatch.ready && msgBatch.exists === false) {
        return {
            older: [],
            live: [],
            hasOlder: false,
            ready: true,
            exists: false,
            serverBatch: null,
            oldest: null,
            olderLoaded: false,
        };
    }

    if (!msgBatch.adoptable) {
        return null;
    }

    const live = trimExpiredMessages(filterChatMessages(msgBatch.messages, chatPK, peerChatPK));
    const expiredKeys = keySet(msgBatch.expiredKeys);
    const deletedKeys = keySet(msgBatch.deletedKeys);
    return {
        older: [],
        live,
        hasOlder: msgBatch.hasOlder,
        ready: true,
        exists: true,
        serverBatch: live.length ? getMessagesBatch(live, expiredKeys, deletedKeys) : { empty: true, expiredKeys, deletedKeys },
        oldest: msgBatch.before,
        olderLoaded: false,
    };
}

export function messageSeedFromView(seed) {
    if (!seed?.ready) {
        return null;
    }

    const older = trimExpiredMessages(seed.older || []);
    const live = trimExpiredMessages(seed.live || []);
    const expiredKeys = keySet(seed.serverBatch?.expiredKeys);
    const deletedKeys = keySet(seed.serverBatch?.deletedKeys);

    return {
        older,
        live,
        hasOlder: !!seed.hasOlder,
        ready: true,
        exists: !!seed.exists,
        serverBatch: live.length ? getMessagesBatch(live, expiredKeys, deletedKeys) : seed.serverBatch?.empty ? { empty: true, expiredKeys, deletedKeys } : null,
        oldest: seed.oldest ?? null,
        olderLoaded: !!seed.olderLoaded,
    };
}

export function makeMessageViewSeed(seed) {
    if (!seed?.ready) {
        return null;
    }

    return {
        older: seed.older || [],
        live: seed.live || [],
        hasOlder: !!seed.hasOlder,
        ready: true,
        exists: !!seed.exists,
        serverBatch: seed.serverBatch ?? null,
        oldest: seed.oldest ?? null,
        olderLoaded: !!seed.olderLoaded,
    };
}
