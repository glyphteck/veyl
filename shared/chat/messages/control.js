import { getMessageOrderMs } from '../state.js';
import { CHAT_RETENTION_24H, CHAT_RETENTION_SEEN, cleanChatRetention, getMessageRetention, hasChatRetention, isTtlExpired, seenMessageTtlMs, withMessageRetention } from '../ttl.js';
import { isAttachmentMsg } from './files.js';
import { hasText } from './text.js';
import {
    DEFAULT_REACTION_EMOJI,
    HOLD_VISIBLE_KEY,
    MAX_REACTIONS,
    READ_RECEIPT_MSG_TYPE,
    REACTION_MSG_TYPE,
    SYSTEM_MSG_TYPE,
    SYSTEM_RETENTION_KIND,
} from './types.js';

function cleanReactionUser(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function cleanReactionEmoji(value) {
    const emoji = typeof value === 'string' ? value.trim() : '';
    return emoji || DEFAULT_REACTION_EMOJI;
}

function cleanReactionTarget(value) {
    const target = typeof value === 'object' && value ? msgKey(value) : value;
    return typeof target === 'string' ? target.trim() : '';
}

export function isPeerMsg(msg, chatPK) {
    const sender = typeof msg?.s === 'string' ? msg.s.trim() : '';
    const user = typeof chatPK === 'string' ? chatPK.trim() : '';
    return !!sender && !!user && sender !== user;
}

export function isServerConfirmedMsg(msg) {
    return !!msg?.id && !String(msg.id).startsWith('local:') && !msg.pending && !msg.failed;
}

export function msgKey(msg) {
    return msg?.cid || msg?.id || null;
}

export function msgKeys(msg) {
    return [...new Set([msgKey(msg), msg?.id, msg?.cid].filter(Boolean))];
}

function messageOrderMs(message) {
    const ms = getMessageOrderMs(message);
    return Number.isFinite(ms) ? ms : null;
}

function hasAnyMsgKey(msg, keys) {
    return !!(keys?.size && msgKeys(msg).some((key) => keys.has(key)));
}

export function makeReadReceipt(target) {
    const upto = String(target?.cid || target?.id || target || '').trim();
    if (!upto) {
        throw new Error('read receipt target required');
    }
    return { t: READ_RECEIPT_MSG_TYPE, upto };
}

export function isReadReceiptMsg(msg) {
    return msg?.t === READ_RECEIPT_MSG_TYPE && hasText(msg.upto);
}

export function makeReaction(target, emoji = DEFAULT_REACTION_EMOJI) {
    const nextTarget = cleanReactionTarget(target);
    if (!nextTarget) {
        throw new Error('reaction target required');
    }

    const nextEmoji = emoji == null ? '' : cleanReactionEmoji(emoji);
    return {
        t: REACTION_MSG_TYPE,
        target: nextTarget,
        ...(nextEmoji ? { emoji: nextEmoji } : {}),
    };
}

export function isReactionMsg(msg) {
    return msg?.t === REACTION_MSG_TYPE && hasText(msg.target) && (msg.emoji == null || hasText(msg.emoji));
}

export function makeRetentionSystemMsg(retention) {
    return {
        t: SYSTEM_MSG_TYPE,
        sys: SYSTEM_RETENTION_KIND,
        retention: cleanChatRetention(retention),
    };
}

export function isSystemMsg(msg) {
    return msg?.t === SYSTEM_MSG_TYPE && msg?.sys === SYSTEM_RETENTION_KIND && !!getSystemMsgText(msg);
}

export function getSystemMsgText(msg) {
    if (msg?.t !== SYSTEM_MSG_TYPE || msg?.sys !== SYSTEM_RETENTION_KIND) {
        return '';
    }

    switch (cleanChatRetention(msg?.retention)) {
        case CHAT_RETENTION_SEEN:
            return 'messages will now expire after being seen';
        case CHAT_RETENTION_24H:
        default:
            return 'messages will now expire 24 hours after being seen';
    }
}

export function isControlMsg(msg) {
    return isReadReceiptMsg(msg) || isReactionMsg(msg);
}

export function isExpiredMsg(msg, now = Date.now()) {
    return isTtlExpired(msg?.ttl, now);
}

function isHeldVisibleMsg(msg) {
    return msg?.[HOLD_VISIBLE_KEY] === true;
}

export function holdVisibleMsg(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || isHeldVisibleMsg(msg)) {
        return msg;
    }
    return Object.defineProperty({ ...msg }, HOLD_VISIBLE_KEY, {
        value: true,
        enumerable: false,
    });
}

export function canShowMsg(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return false;
    }
    if (isExpiredMsg(msg) && !isHeldVisibleMsg(msg)) {
        return false;
    }

    switch (msg.t) {
        case 'txt':
            return hasText(msg.c);
        case 'req':
            return hasText(msg.a);
        case SYSTEM_MSG_TYPE:
            return !!getSystemMsgText(msg);
        default:
            return isAttachmentMsg(msg);
    }
}

export function canStoreMsg(msg) {
    if (isExpiredMsg(msg)) {
        return false;
    }
    return canShowMsg(msg) || isControlMsg(msg);
}

export function getMsgReactions(msg) {
    const raw = Array.isArray(msg?.reactions) ? msg.reactions : [];
    const seen = new Set();
    const reactions = [];

    for (const item of raw) {
        const user = cleanReactionUser(item?.user);
        const emoji = cleanReactionEmoji(item?.emoji);
        if (!user || seen.has(user)) {
            continue;
        }
        seen.add(user);
        reactions.push({ emoji, user });
        if (reactions.length >= MAX_REACTIONS) {
            break;
        }
    }

    return reactions;
}

function sameReactions(a, b) {
    const left = getMsgReactions({ reactions: a });
    const right = getMsgReactions({ reactions: b });
    if (left.length !== right.length) {
        return false;
    }
    return left.every((reaction, index) => reaction.user === right[index]?.user && reaction.emoji === right[index]?.emoji);
}

export function deriveMessageReactions(messages, chatPK, peerChatPK) {
    const participants = [chatPK, peerChatPK].filter(Boolean);
    if (!Array.isArray(messages) || !messages.length || !participants.length) {
        return messages || [];
    }

    const allowed = new Set(participants);
    const byTarget = new Map();

    for (const msg of messages) {
        if (!isServerConfirmedMsg(msg) || !isReactionMsg(msg)) {
            continue;
        }

        const user = cleanReactionUser(msg.s || msg.from);
        const target = cleanReactionTarget(msg.target);
        if (!user || !allowed.has(user) || !target) {
            continue;
        }

        let reactions = byTarget.get(target);
        if (!reactions) {
            reactions = new Map();
            byTarget.set(target, reactions);
        }

        if (hasText(msg.emoji)) {
            reactions.set(user, { emoji: cleanReactionEmoji(msg.emoji), user });
        } else {
            reactions.delete(user);
        }
    }

    return messages.map((msg) => {
        if (!canShowMsg(msg) || isSystemMsg(msg)) {
            return msg;
        }

        const target = msgKey(msg);
        const reactionsByUser = target ? byTarget.get(target) : null;
        const reactions = participants.map((user) => reactionsByUser?.get(user)).filter(Boolean).slice(0, MAX_REACTIONS);
        if (sameReactions(msg.reactions, reactions)) {
            return msg;
        }

        const { reactions: _oldReactions, ...next } = msg;
        return reactions.length ? { ...next, reactions } : next;
    });
}

export function getLatestReadReceiptTarget(messages, chatPK) {
    let latestSentReceipt = null;
    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (!isServerConfirmedMsg(msg)) {
            continue;
        }

        if (!isPeerMsg(msg, chatPK) && isReadReceiptMsg(msg) && !latestSentReceipt) {
            latestSentReceipt = msg;
            continue;
        }

        if (isPeerMsg(msg, chatPK) && canShowMsg(msg) && !isSystemMsg(msg)) {
            return latestSentReceipt?.upto === msgKey(msg) ? null : msg;
        }
    }
    return null;
}

export function getLatestOwnReadReceiptTarget(messages, chatPK) {
    let target = null;
    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (isServerConfirmedMsg(msg) && !isPeerMsg(msg, chatPK) && isReadReceiptMsg(msg)) {
            target = msg.upto;
            break;
        }
    }

    if (!target) {
        return null;
    }

    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (isServerConfirmedMsg(msg) && isPeerMsg(msg, chatPK) && canShowMsg(msg) && !isSystemMsg(msg) && msgKey(msg) === target) {
            return msg;
        }
    }
    return null;
}

export function getLatestReadOutgoingReceipt(messages, chatPK, peerChatPK) {
    let target = null;
    let receipt = null;
    let receiptOrderMs = Infinity;
    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (isServerConfirmedMsg(msg) && isPeerMsg(msg, chatPK) && msg?.s === peerChatPK && isReadReceiptMsg(msg)) {
            target = msg.upto;
            receipt = msg;
            receiptOrderMs = getMessageOrderMs(msg);
            break;
        }
    }

    if (!target) {
        return null;
    }

    let fallback = null;
    const targetOrderMs = getMessageOrderMs({ cid: target });
    const fallbackMaxOrderMs = Number.isFinite(targetOrderMs) ? targetOrderMs : receiptOrderMs;
    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (!isServerConfirmedMsg(msg) || isPeerMsg(msg, chatPK) || !canShowMsg(msg) || isSystemMsg(msg)) {
            continue;
        }
        if (msgKey(msg) === target) {
            return { message: msg, receipt };
        }
        if (!fallback && getMessageOrderMs(msg) <= fallbackMaxOrderMs) {
            fallback = msg;
        }
    }
    return fallback ? { message: fallback, receipt } : null;
}

export function getLatestReadOutgoingReceiptMessage(messages, chatPK, peerChatPK) {
    return getLatestReadOutgoingReceipt(messages, chatPK, peerChatPK)?.message ?? null;
}

function readReceiptFromRecipient(receipt, msg, chatPK, peerChatPK) {
    const messageFromPeer = isPeerMsg(msg, chatPK);
    const receiptFromPeer = isPeerMsg(receipt, chatPK);
    return messageFromPeer ? !receiptFromPeer : receiptFromPeer && (!peerChatPK || receipt?.s === peerChatPK);
}

function readReceiptCoversMessage(receipt, msg, byKey, chatPK, peerChatPK) {
    const targetKey = typeof receipt?.upto === 'string' ? receipt.upto.trim() : '';
    if (!targetKey || !readReceiptFromRecipient(receipt, msg, chatPK, peerChatPK)) {
        return false;
    }
    if (msgKeys(msg).includes(targetKey)) {
        return true;
    }

    const target = byKey.get(targetKey);
    if (target && isPeerMsg(target, chatPK) !== isPeerMsg(msg, chatPK)) {
        return false;
    }

    const messageMs = messageOrderMs(msg);
    const targetMs = messageOrderMs(target) ?? messageOrderMs({ cid: targetKey }) ?? messageOrderMs(receipt);
    return messageMs != null && targetMs != null && messageMs <= targetMs;
}

function messageSeenAtMs(msg, receipts, byKey, chatPK, peerChatPK) {
    let seenAt = null;
    for (const receipt of receipts || []) {
        if (!readReceiptCoversMessage(receipt, msg, byKey, chatPK, peerChatPK)) {
            continue;
        }
        const receiptMs = messageOrderMs(receipt);
        if (receiptMs != null && (seenAt == null || receiptMs < seenAt)) {
            seenAt = receiptMs;
        }
    }
    return seenAt;
}

function isSeenHiddenMsg(msg, receipts, byKey, chatPK, peerChatPK, now) {
    if (!isServerConfirmedMsg(msg) || isControlMsg(msg) || isSystemMsg(msg) || !canShowMsg(msg) || msg.ttl == null) {
        return false;
    }

    const seenAt = messageSeenAtMs(msg, receipts, byKey, chatPK, peerChatPK);
    if (seenAt == null) {
        return false;
    }

    return getMessageRetention(msg) === CHAT_RETENTION_SEEN || seenMessageTtlMs(seenAt) <= now;
}

export function getSeenHiddenMessages(messages, chatPK, peerChatPK, options = {}) {
    if (!Array.isArray(messages) || !messages.length || !chatPK) {
        return [];
    }

    const keepKeys = options?.keepKeys instanceof Set ? options.keepKeys : new Set(Array.isArray(options?.keepKeys) ? options.keepKeys.filter(Boolean) : []);
    const now = Number.isFinite(options?.now) ? options.now : Date.now();
    const byKey = new Map();
    const receipts = [];

    for (const msg of messages) {
        for (const key of msgKeys(msg)) {
            byKey.set(key, msg);
        }
        if (isServerConfirmedMsg(msg) && isReadReceiptMsg(msg)) {
            receipts.push(msg);
        }
    }

    if (!receipts.length) {
        return [];
    }

    return messages.filter((msg) => !hasAnyMsgKey(msg, keepKeys) && isSeenHiddenMsg(msg, receipts, byKey, chatPK, peerChatPK, now));
}

export function filterSeenMessages(messages, chatPK, peerChatPK, options = {}) {
    const hidden = getSeenHiddenMessages(messages, chatPK, peerChatPK, options);
    if (!hidden.length) {
        return messages || [];
    }

    const hiddenKeys = new Set();
    for (const msg of hidden) {
        for (const key of msgKeys(msg)) {
            hiddenKeys.add(key);
        }
    }

    return (messages || []).filter((msg) => !hasAnyMsgKey(msg, hiddenKeys));
}

export function getHiddenDisplayMessages(messages, chatPK, peerChatPK, options = {}) {
    return getSeenHiddenMessages(applyMessageRetentionTimeline(messages, options.fallback), chatPK, peerChatPK, options);
}

export function getDisplayMessages(messages, chatPK, peerChatPK, options = {}) {
    return filterSeenMessages(applyMessageRetentionTimeline(messages, options.fallback), chatPK, peerChatPK, options);
}

function replaceSystemRow(previous, next) {
    return {
        ...next,
        ...(previous?.id ? { id: previous.id } : {}),
        ...(previous?.cid ? { cid: previous.cid } : {}),
    };
}

export function collapseSystemMessages(messages) {
    const collapsed = [];
    for (const msg of messages || []) {
        if (isSystemMsg(msg) && isSystemMsg(collapsed[collapsed.length - 1])) {
            collapsed[collapsed.length - 1] = replaceSystemRow(collapsed[collapsed.length - 1], msg);
            continue;
        }
        collapsed.push(msg);
    }
    return collapsed;
}

export function applyMessageRetentionTimeline(messages, fallback = CHAT_RETENTION_24H) {
    if (!Array.isArray(messages) || !messages.length) {
        return messages || [];
    }

    let retention = cleanChatRetention(fallback);
    let changed = false;
    const next = messages.map((msg) => {
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
            return msg;
        }
        if (isSystemMsg(msg)) {
            retention = cleanChatRetention(msg.retention);
            return msg;
        }
        if (isControlMsg(msg) || hasChatRetention(msg.retention) || !canShowMsg(msg)) {
            return msg;
        }
        changed = true;
        return withMessageRetention(msg, retention);
    });

    return changed ? next : messages;
}
