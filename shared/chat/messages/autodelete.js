'use client';

import { addMessageKeys, collectMessageKeys, indexMessagesByKey, keySet, messageHasKey, targetMessageMs } from '../messagekeys.js';
import { getMessageKey, getMessageOrderMs } from '../state.js';
import { cleanText } from '../../utils/text.js';
import {
    canShowMsg,
    getHiddenDisplayMessages,
    isControlMsg,
    isHiddenCheckpointMsg,
    isPeerMsg,
    isServerConfirmedMsg,
    isSystemMsg,
} from './control.js';
import { hasMediaStay } from './files.js';

const pendingDeleteKeys = new Set();

function latestMessage(messages) {
    let latest = null;
    let latestMs = null;
    for (const msg of messages || []) {
        const ms = getMessageOrderMs(msg);
        if (!Number.isFinite(ms)) {
            continue;
        }
        if (latestMs == null || ms > latestMs) {
            latest = msg;
            latestMs = ms;
        }
    }
    return latest ? { message: latest, ms: latestMs, key: getMessageKey(latest) } : null;
}

export function getHiddenCheckpointMs(messages, participant, byKey = indexMessagesByKey(messages)) {
    if (!participant) {
        return null;
    }

    let latest = null;
    for (const msg of messages || []) {
        if (!isServerConfirmedMsg(msg) || msg.s !== participant || !isHiddenCheckpointMsg(msg)) {
            continue;
        }
        const ms = targetMessageMs(msg.upto, byKey);
        if (ms != null && (latest == null || ms > latest)) {
            latest = ms;
        }
    }
    return latest;
}

export function getHiddenCheckpointTarget(messages, chatPK, peerChatPK, options = {}) {
    if (!chatPK || !peerChatPK || !Array.isArray(messages) || !messages.length) {
        return null;
    }

    const keepKeys = keySet(options?.keepKeys);
    const hidden = getHiddenDisplayMessages(messages, chatPK, peerChatPK, { ...options, keepKeys: new Set() });
    let firstKeptMs = null;
    for (const msg of hidden) {
        if (!messageHasKey(msg, keepKeys)) {
            continue;
        }
        const ms = getMessageOrderMs(msg);
        if (Number.isFinite(ms) && (firstKeptMs == null || ms < firstKeptMs)) {
            firstKeptMs = ms;
        }
    }

    const checkpointable = firstKeptMs == null ? hidden : hidden.filter((msg) => {
        const ms = getMessageOrderMs(msg);
        return Number.isFinite(ms) && ms < firstKeptMs;
    });
    const target = latestMessage(checkpointable);
    const minMs = Number.isFinite(options?.minMs) ? options.minMs : null;
    if (!target || !target.key || (minMs != null && target.ms <= minMs)) {
        return null;
    }
    return target;
}

function canAutoDeleteMessage(msg, chatPK) {
    return (
        isServerConfirmedMsg(msg) &&
        isPeerMsg(msg, chatPK) &&
        canShowMsg(msg) &&
        !isControlMsg(msg) &&
        !isSystemMsg(msg) &&
        msg.ttl != null &&
        msg.permanent !== true &&
        !hasMediaStay(msg)
    );
}

export function getAutoDeleteMessages(messages, chatPK, peerChatPK, options = {}) {
    if (!chatPK || !peerChatPK || !Array.isArray(messages) || !messages.length) {
        return [];
    }

    const byKey = indexMessagesByKey(messages);
    const ownCheckpointMs = Math.max(getHiddenCheckpointMs(messages, chatPK, byKey) ?? 0, Number.isFinite(options?.ownCheckpointMs) ? options.ownCheckpointMs : 0);
    const peerCheckpointMs = getHiddenCheckpointMs(messages, peerChatPK, byKey) ?? 0;
    if (!ownCheckpointMs || !peerCheckpointMs) {
        return [];
    }

    const hidden = getHiddenDisplayMessages(messages, chatPK, peerChatPK, options);
    if (!hidden.length) {
        return [];
    }

    const hiddenKeys = collectMessageKeys(hidden);
    const keepKeys = keySet(options?.keepKeys);
    const deleteKeys = keySet(options?.deletedKeys);
    return hidden.filter((msg) => {
        if (!canAutoDeleteMessage(msg, chatPK) || messageHasKey(msg, keepKeys) || messageHasKey(msg, deleteKeys)) {
            return false;
        }
        if (!messageHasKey(msg, hiddenKeys)) {
            return false;
        }
        const ms = getMessageOrderMs(msg);
        return Number.isFinite(ms) && ms <= ownCheckpointMs && ms <= peerCheckpointMs;
    });
}

function autoDeleteKey(chatId, msg) {
    const id = cleanText(msg?.id);
    return chatId && id ? `${chatId}/${id}` : '';
}

function claimDeleteMessages(chatId, messages) {
    const claimed = [];
    for (const msg of messages || []) {
        const key = autoDeleteKey(chatId, msg);
        if (!key || pendingDeleteKeys.has(key)) {
            continue;
        }
        pendingDeleteKeys.add(key);
        claimed.push(msg);
    }
    return claimed;
}

function releaseDeleteMessages(chatId, messages) {
    for (const msg of messages || []) {
        const key = autoDeleteKey(chatId, msg);
        if (key) {
            pendingDeleteKeys.delete(key);
        }
    }
}

export async function deleteAutoHiddenMessages({ chatId, messages, chatPK, peerChatPK, keepKeys, deletedKeys, ownCheckpointMs, deleteMessages }) {
    if (!chatId || typeof deleteMessages !== 'function') {
        return [];
    }

    const candidates = getAutoDeleteMessages(messages, chatPK, peerChatPK, { keepKeys, deletedKeys, ownCheckpointMs });
    const targets = claimDeleteMessages(chatId, candidates);
    if (!targets.length) {
        return [];
    }

    try {
        await deleteMessages(targets);
        return targets;
    } finally {
        releaseDeleteMessages(chatId, targets);
    }
}

export async function runMessageAutoDelete({ chatId, messages, chatPK, peerChatPK, keepKeys, deletedKeys, state, writeHiddenCheckpoint, deleteMessages }) {
    if (!chatId || !chatPK || !peerChatPK || !Array.isArray(messages) || !messages.length) {
        return { checkpoint: null, deleted: [] };
    }

    const autoState = state || {};
    const byKey = indexMessagesByKey(messages);
    const existingOwnCheckpointMs = getHiddenCheckpointMs(messages, chatPK, byKey) ?? 0;
    autoState.checkpointMs = Math.max(Number.isFinite(autoState.checkpointMs) ? autoState.checkpointMs : 0, existingOwnCheckpointMs);

    let checkpoint = null;
    if (typeof writeHiddenCheckpoint === 'function') {
        const target = getHiddenCheckpointTarget(messages, chatPK, peerChatPK, {
            keepKeys,
            minMs: Math.max(autoState.checkpointMs || 0, autoState.pendingCheckpointMs || 0),
        });
        if (target?.message && target.ms > (autoState.checkpointMs || 0)) {
            autoState.pendingCheckpointMs = target.ms;
            try {
                await writeHiddenCheckpoint(target.message);
                autoState.checkpointMs = Math.max(autoState.checkpointMs || 0, target.ms);
                checkpoint = target;
            } finally {
                if (autoState.pendingCheckpointMs === target.ms) {
                    autoState.pendingCheckpointMs = 0;
                }
            }
        }
    }

    const deleted = await deleteAutoHiddenMessages({
        chatId,
        messages,
        chatPK,
        peerChatPK,
        keepKeys,
        deletedKeys,
        ownCheckpointMs: autoState.checkpointMs,
        deleteMessages,
    });

    if (deleted.length && deletedKeys?.add) {
        for (const msg of deleted) {
            addMessageKeys(deletedKeys, msg);
        }
    }

    return { checkpoint, deleted };
}
