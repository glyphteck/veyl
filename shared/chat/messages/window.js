import { dropCachedMedia } from '../../cache/localdata.js';
import { filterChatMessages } from '../ids.js';
import { addMessageKeys, keySet, messageHasKey } from '../messagekeys.js';
import { getMessageKey, getMessageOrderMs, mergeMessages } from '../state.js';
import { deriveMessageReactions, getDisplayMessages, holdVisibleMsg, isExpiredMsg } from './control.js';

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

export function mergeKeySets(...groups) {
    const keys = new Set();
    for (const group of groups) {
        for (const key of keySet(group)) {
            keys.add(key);
        }
    }
    return keys;
}

function messagePageMarker(message) {
    if (!message?.id || String(message.id).startsWith('local:') || !message?.ts) {
        return null;
    }
    return { id: message.id, ts: message.ts };
}

export function firstMessageWindowMarker(older, live) {
    if (!older?.length) {
        return null;
    }

    let first = null;
    let firstMs = Infinity;
    for (const messages of [older, live]) {
        for (const message of messages || []) {
            const marker = messagePageMarker(message);
            const ms = getMessageOrderMs(marker);
            if (!marker || !Number.isFinite(ms)) {
                continue;
            }
            if (ms < firstMs || (ms === firstMs && marker.id < first.id)) {
                first = marker;
                firstMs = ms;
            }
        }
    }
    return first;
}

export function messageWindowMarkerKey(marker) {
    if (!marker?.id) {
        return '';
    }
    const ms = getMessageOrderMs(marker);
    return `${marker.id}:${Number.isFinite(ms) ? ms : ''}`;
}

export function selectRouteMessageState({ stateScope, scopeKey, initialSeed, older, live, hasOlder, ready, exists, serverBatch, fallbackReady = false }) {
    const matches = stateScope === scopeKey;
    return {
        older: matches ? older : initialSeed?.older ?? [],
        live: matches ? live : initialSeed?.live ?? [],
        hasOlder: matches ? hasOlder : initialSeed?.hasOlder ?? false,
        ready: matches ? ready : initialSeed?.ready ?? fallbackReady,
        exists: matches ? exists : initialSeed?.exists ?? false,
        serverBatch: matches ? serverBatch : initialSeed?.serverBatch ?? null,
    };
}

export function deriveRouteMessages({ older, live, locals, serverBatch, deletedKeys, visibleKeys, chatPK, peerChatPK }) {
    const liveKeys = new Set((live || []).map(getMessageKey).filter(Boolean));
    const sourceGoneKeys = mergeKeySets(serverBatch?.deletedKeys, deletedKeys);
    const cleanOlder = serverBatch?.empty ? [] : dropMissingFromBatch(older, serverBatch, liveKeys);
    const renderLocals =
        liveKeys.size || sourceGoneKeys.size
            ? (locals || []).filter((message) => {
                  const key = getMessageKey(message);
                  return (!key || !liveKeys.has(key)) && !messageHasKey(message, sourceGoneKeys);
              })
            : locals || [];
    const rawMessages = filterChatMessages(mergeMessages(cleanOlder, live, renderLocals), chatPK, peerChatPK);
    const retainedMessages = getDisplayMessages(rawMessages, chatPK, peerChatPK, {
        keepKeys: visibleKeys,
    });
    return {
        rawMessages,
        messages: deriveMessageReactions(retainedMessages, chatPK, peerChatPK).map(holdVisibleMsg),
    };
}

export function dropDeletedMessageWindow({ older, live, deletedKeys, removedKeys, snapshotKeys, fromMs, cidById }) {
    const explicitKeys = keySet(removedKeys);
    const currentKeys = snapshotKeys ? keySet(snapshotKeys) : null;
    const currentCidById = cidById instanceof Map ? cidById : null;
    if (!explicitKeys.size && !currentKeys && !currentCidById) {
        return null;
    }

    const nextDeletedKeys = keySet(deletedKeys);
    const deletedKeyCount = nextDeletedKeys.size;
    for (const key of explicitKeys) {
        nextDeletedKeys.add(key);
    }
    const deletedKeysChanged = nextDeletedKeys.size !== deletedKeyCount;

    const drop = (messages) => {
        let dropped = false;
        const droppedMessages = [];
        const next = [];
        for (const message of messages || []) {
            const isServerMessage = !!message?.id && !String(message.id).startsWith('local:');
            const ms = getMessageOrderMs(message);
            const inSnapshotRange = isServerMessage && Number.isFinite(ms) && Number.isFinite(fromMs) && ms >= fromMs;
            const explicitlyRemoved = messageHasKey(message, explicitKeys);
            const missingFromSnapshot = currentKeys && inSnapshotRange && !messageHasKey(message, currentKeys);
            const sourceCid = currentCidById && inSnapshotRange ? currentCidById.get(message.id) : null;
            const sourceChanged = !!(sourceCid && message?.cid && sourceCid !== message.cid);
            if (explicitlyRemoved || missingFromSnapshot || sourceChanged) {
                dropped = true;
                addMessageKeys(nextDeletedKeys, message);
                droppedMessages.push(message);
            } else {
                next.push(message);
            }
        }
        return { messages: dropped ? next : messages, dropped, droppedMessages };
    };

    const olderDrop = drop(older);
    const liveDrop = drop(live);
    if (!deletedKeysChanged && !olderDrop.dropped && !liveDrop.dropped) {
        return null;
    }

    return {
        deletedKeys: nextDeletedKeys,
        older: olderDrop.messages,
        live: liveDrop.messages,
        olderChanged: olderDrop.dropped,
        liveChanged: liveDrop.dropped,
        droppedMessages: [...olderDrop.droppedMessages, ...liveDrop.droppedMessages],
    };
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
            olderThan: null,
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
        olderThan: msgBatch.olderThan,
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
        olderThan: seed.olderThan ?? null,
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
        olderThan: seed.olderThan ?? null,
        olderLoaded: !!seed.olderLoaded,
    };
}
