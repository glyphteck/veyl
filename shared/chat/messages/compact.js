'use client';

import { addMessageKeys, indexMessagesByKey, keySet, targetMessageMs } from '../messagekeys.js';
import { getMessageKey, getMessageOrderMs, sortMessages } from '../state.js';
import { cleanText } from '../../utils/text.js';
import {
    canShowMsg,
    isControlMsg,
    isHiddenCheckpointMsg,
    isReactionMsg,
    isReadReceiptMsg,
    isServerConfirmedMsg,
    isSystemMsg,
} from './control.js';

const pendingCompactKeys = new Set();

function messageMs(msg) {
    const ms = getMessageOrderMs(msg);
    return Number.isFinite(ms) ? ms : null;
}

function senderKey(msg) {
    return cleanText(msg?.s) || cleanText(msg?.from);
}

function reactionTarget(msg) {
    return cleanText(msg?.target);
}

function addMsg(targets, msg) {
    if (!isServerConfirmedMsg(msg)) {
        return;
    }
    const key = getMessageKey(msg);
    if (key) {
        targets.set(key, msg);
    }
}

function getCoveredControlDeletes(messages, byKey, matches) {
    const groups = new Map();
    for (const msg of messages || []) {
        if (!isServerConfirmedMsg(msg) || !matches(msg)) {
            continue;
        }
        const sender = senderKey(msg);
        const uptoMs = targetMessageMs(msg.upto, byKey);
        if (!sender || uptoMs == null) {
            continue;
        }
        const item = { msg, uptoMs, ms: messageMs(msg) ?? uptoMs };
        const group = groups.get(sender) || [];
        group.push(item);
        groups.set(sender, group);
    }

    const targets = new Map();
    for (const group of groups.values()) {
        let keeper = null;
        for (const item of group) {
            if (!keeper || item.uptoMs > keeper.uptoMs || (item.uptoMs === keeper.uptoMs && item.ms > keeper.ms)) {
                keeper = item;
            }
        }
        if (!keeper) {
            continue;
        }
        for (const item of group) {
            if (item !== keeper && item.uptoMs <= keeper.uptoMs) {
                addMsg(targets, item.msg);
            }
        }
    }
    return targets;
}

function getDuplicateReadReceiptDeletes(messages) {
    const groups = new Map();
    for (const msg of messages || []) {
        if (!isServerConfirmedMsg(msg) || !isReadReceiptMsg(msg)) {
            continue;
        }
        const sender = senderKey(msg);
        const upto = cleanText(msg.upto);
        if (!sender || !upto) {
            continue;
        }
        const key = `${sender}:${upto}`;
        const group = groups.get(key) || [];
        group.push({ msg, ms: messageMs(msg) ?? 0 });
        groups.set(key, group);
    }

    const targets = new Map();
    for (const group of groups.values()) {
        let keeper = null;
        for (const item of group) {
            if (!keeper || item.ms < keeper.ms) {
                keeper = item;
            }
        }
        for (const item of group) {
            if (item !== keeper) {
                addMsg(targets, item.msg);
            }
        }
    }
    return targets;
}

function getReactionDeletes(messages, deletedKeys) {
    const latestByActorTarget = new Map();
    const reactions = [];
    const targets = new Map();

    for (const msg of messages || []) {
        if (!isServerConfirmedMsg(msg) || !isReactionMsg(msg)) {
            continue;
        }
        const sender = senderKey(msg);
        const target = reactionTarget(msg);
        if (!sender || !target) {
            continue;
        }
        if (deletedKeys?.has?.(target)) {
            addMsg(targets, msg);
            continue;
        }

        const item = { msg, ms: messageMs(msg) ?? 0 };
        const key = `${sender}:${target}`;
        const current = latestByActorTarget.get(key);
        if (!current || item.ms > current.ms) {
            latestByActorTarget.set(key, item);
        }
        reactions.push({ key, ...item });
    }

    for (const item of reactions) {
        if (latestByActorTarget.get(item.key)?.msg !== item.msg) {
            addMsg(targets, item.msg);
        }
    }
    return targets;
}

function getSystemDeletes(messages) {
    const targets = new Map();
    let pendingSystem = null;

    for (const msg of sortMessages(messages || [])) {
        if (!isServerConfirmedMsg(msg)) {
            continue;
        }
        if (isControlMsg(msg)) {
            continue;
        }
        if (isSystemMsg(msg)) {
            if (pendingSystem) {
                addMsg(targets, pendingSystem);
            }
            pendingSystem = msg;
            continue;
        }
        if (canShowMsg(msg)) {
            pendingSystem = null;
        }
    }

    return targets;
}

export function getCompactMessages(messages, options = {}) {
    if (!Array.isArray(messages) || !messages.length) {
        return [];
    }

    const deletedKeys = keySet(options?.deletedKeys);
    const byKey = indexMessagesByKey(messages);
    const targets = new Map();

    for (const msg of getDuplicateReadReceiptDeletes(messages).values()) {
        addMsg(targets, msg);
    }
    for (const msg of getCoveredControlDeletes(messages, byKey, isHiddenCheckpointMsg).values()) {
        addMsg(targets, msg);
    }
    for (const msg of getReactionDeletes(messages, deletedKeys).values()) {
        addMsg(targets, msg);
    }
    for (const msg of getSystemDeletes(messages).values()) {
        addMsg(targets, msg);
    }

    return [...targets.values()];
}

function compactKey(chatId, msg) {
    const id = cleanText(msg?.id);
    return chatId && id ? `${chatId}/${id}` : '';
}

function claimMessages(chatId, messages) {
    const claimed = [];
    for (const msg of messages || []) {
        const key = compactKey(chatId, msg);
        if (!key || pendingCompactKeys.has(key)) {
            continue;
        }
        pendingCompactKeys.add(key);
        claimed.push(msg);
    }
    return claimed;
}

function releaseMessages(chatId, messages) {
    for (const msg of messages || []) {
        const key = compactKey(chatId, msg);
        if (key) {
            pendingCompactKeys.delete(key);
        }
    }
}

export async function compactMessages({ chatId, messages, deletedKeys, deleteMessages }) {
    if (!chatId || typeof deleteMessages !== 'function') {
        return [];
    }

    const targets = claimMessages(chatId, getCompactMessages(messages, { deletedKeys }));
    if (!targets.length) {
        return [];
    }

    try {
        await deleteMessages(targets);
        if (deletedKeys?.add) {
            for (const msg of targets) {
                addMessageKeys(deletedKeys, msg);
            }
        }
        return targets;
    } finally {
        releaseMessages(chatId, targets);
    }
}
