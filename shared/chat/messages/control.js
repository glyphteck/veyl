import { getMessageKey, getMessageOrderMs } from '../state.js';
import { collectMessageKeys, indexMessagesByKey, messageHasKey, messageKeys } from '../messagekeys.js';
import { CHAT_RETENTION_24H, CHAT_RETENTION_SEEN, cleanChatRetention, getMessageRetention, hasChatRetention, isTtlExpired, seenMessageTtlMs, withMessageRetention } from '../ttl.js';
import { cleanText } from '../../utils/text.js';
import { hasSharedMediaFileRef, isAttachmentMsg } from './files.js';
import { hasText } from './text.js';
import {
    DEFAULT_REACTION_EMOJI,
    HIDDEN_CHECKPOINT_MSG_TYPE,
    HOLD_VISIBLE_KEY,
    MAX_REACTIONS,
    READ_RECEIPT_MSG_TYPE,
    REACTION_MSG_TYPE,
    SYSTEM_MSG_TYPE,
    SYSTEM_RETENTION_KIND,
} from './types.js';

const retainedMessageCache = new WeakMap();

function cleanReactionUser(value) {
    return cleanText(value);
}

function cleanReactionEmoji(value) {
    const emoji = cleanText(value);
    return emoji || DEFAULT_REACTION_EMOJI;
}

function cleanTarget(value) {
    const target = typeof value === 'object' && value ? getMessageKey(value) : value;
    return cleanText(target);
}

export function isPeerMsg(msg, chatPK) {
    const sender = cleanText(msg?.s);
    const user = cleanText(chatPK);
    return !!sender && !!user && sender !== user;
}

export function isServerConfirmedMsg(msg) {
    return !!msg?.id && !String(msg.id).startsWith('local:') && !msg.pending && !msg.failed;
}

export function hasMessageTtl(msg) {
    return Object.prototype.hasOwnProperty.call(msg || {}, 'ttl');
}

export function isSavedForeverMsg(msg) {
    return isServerConfirmedMsg(msg) && hasMessageTtl(msg) && msg.ttl == null;
}

export function canToggleSaveForeverMsg(msg) {
    return isServerConfirmedMsg(msg) && !isSystemMsg(msg) && !hasSharedMediaFileRef(msg);
}

function messageOrderMs(message) {
    const ms = getMessageOrderMs(message);
    return Number.isFinite(ms) ? ms : null;
}

function hasAnyMsgKey(msg, keys) {
    return messageHasKey(msg, keys);
}

export function makeReadReceipt(target) {
    const upto = cleanTarget(target);
    if (!upto) {
        throw new Error('read receipt target required');
    }
    return { t: READ_RECEIPT_MSG_TYPE, upto };
}

export function isReadReceiptMsg(msg) {
    return msg?.t === READ_RECEIPT_MSG_TYPE && hasText(msg.upto);
}

export function makeReaction(target, emoji = DEFAULT_REACTION_EMOJI) {
    const nextTarget = cleanTarget(target);
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

export function makeHiddenCheckpoint(target) {
    const upto = cleanTarget(target);
    if (!upto) {
        throw new Error('hidden checkpoint target required');
    }
    return { t: HIDDEN_CHECKPOINT_MSG_TYPE, upto };
}

export function isHiddenCheckpointMsg(msg) {
    return msg?.t === HIDDEN_CHECKPOINT_MSG_TYPE && hasText(msg.upto);
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
    return isReadReceiptMsg(msg) || isReactionMsg(msg) || isHiddenCheckpointMsg(msg);
}

export function isActionMutationMsg(msg) {
    return msg?.actionOp === 'edit' || msg?.actionOp === 'pay_confirm';
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
    return canShowMsg(msg) || isControlMsg(msg) || isActionMutationMsg(msg);
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

function hasReactionControl(messages) {
    for (const msg of messages || []) {
        if (isServerConfirmedMsg(msg) && isReactionMsg(msg)) {
            return true;
        }
    }
    return false;
}

function needsRetentionProjection(messages) {
    for (const msg of messages || []) {
        if (isSystemMsg(msg) || isReadReceiptMsg(msg)) {
            return true;
        }
    }
    return false;
}

export function deriveMessageReactions(messages, chatPK, peerChatPK) {
    const participants = [chatPK, peerChatPK].filter(Boolean);
    if (!Array.isArray(messages) || !messages.length || !participants.length) {
        return messages || [];
    }
    if (!hasReactionControl(messages)) {
        return messages;
    }

    const allowed = new Set(participants);
    const byTarget = new Map();

    for (const msg of messages) {
        if (!isServerConfirmedMsg(msg) || !isReactionMsg(msg)) {
            continue;
        }

        const user = cleanReactionUser(msg.s || msg.from);
        const target = cleanTarget(msg.target);
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

        const target = getMessageKey(msg);
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
            return latestSentReceipt?.upto === getMessageKey(msg) ? null : msg;
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
        if (isServerConfirmedMsg(msg) && isPeerMsg(msg, chatPK) && canShowMsg(msg) && !isSystemMsg(msg) && getMessageKey(msg) === target) {
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
        if (getMessageKey(msg) === target) {
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

function receiptCoverageTarget(receipt, byKey) {
    const targetKey = cleanText(receipt?.upto);
    if (!targetKey) {
        return null;
    }
    const target = byKey.get(targetKey);
    const targetMs = messageOrderMs(target) ?? messageOrderMs({ cid: targetKey }) ?? messageOrderMs(receipt);
    const receiptMs = messageOrderMs(receipt);
    if (targetMs == null || receiptMs == null) {
        return null;
    }
    return {
        target,
        targetMs,
        receiptMs,
    };
}

function makeReceiptCoverage(messages, byKey, chatPK, peerChatPK) {
    const peerMessageReceipts = [];
    const ownMessageReceipts = [];

    for (const msg of messages || []) {
        if (!isServerConfirmedMsg(msg) || !isReadReceiptMsg(msg)) {
            continue;
        }

        const coverage = receiptCoverageTarget(msg, byKey);
        if (!coverage) {
            continue;
        }

        const receiptFromPeer = isPeerMsg(msg, chatPK);
        if (receiptFromPeer) {
            if (peerChatPK && msg?.s !== peerChatPK) {
                continue;
            }
            if (coverage.target && isPeerMsg(coverage.target, chatPK)) {
                continue;
            }
            ownMessageReceipts.push(coverage);
        } else {
            if (coverage.target && !isPeerMsg(coverage.target, chatPK)) {
                continue;
            }
            peerMessageReceipts.push(coverage);
        }
    }

    peerMessageReceipts.sort((a, b) => b.targetMs - a.targetMs);
    ownMessageReceipts.sort((a, b) => b.targetMs - a.targetMs);
    return {
        peer: { receipts: peerMessageReceipts, index: 0, seenAt: null },
        own: { receipts: ownMessageReceipts, index: 0, seenAt: null },
    };
}

function receiptCoverageSeenAt(state, messageMs) {
    if (!state || messageMs == null) {
        return null;
    }

    while (state.index < state.receipts.length && state.receipts[state.index].targetMs >= messageMs) {
        const receiptMs = state.receipts[state.index].receiptMs;
        state.seenAt = state.seenAt == null ? receiptMs : Math.min(state.seenAt, receiptMs);
        state.index += 1;
    }
    return state.seenAt;
}

function hasReadReceipts(messages) {
    for (const msg of messages || []) {
        if (isServerConfirmedMsg(msg) && isReadReceiptMsg(msg)) {
            return true;
        }
    }
    return false;
}

function canReadReceiptsHideMessages(messages, now) {
    let hasSeenRetention = false;
    let hasExpiredSeenWindow = false;

    for (const msg of messages || []) {
        if (isServerConfirmedMsg(msg) && isReadReceiptMsg(msg)) {
            const ms = messageOrderMs(msg);
            if (ms != null && seenMessageTtlMs(ms) <= now) {
                hasExpiredSeenWindow = true;
            }
            continue;
        }

        if (getMessageRetention(msg) === CHAT_RETENTION_SEEN) {
            hasSeenRetention = true;
        }

        if (hasSeenRetention && hasExpiredSeenWindow) {
            return true;
        }
    }

    return hasSeenRetention || hasExpiredSeenWindow;
}

export function getSeenHiddenMessages(messages, chatPK, peerChatPK, options = {}) {
    if (!Array.isArray(messages) || !messages.length || !chatPK) {
        return [];
    }
    if (!hasReadReceipts(messages)) {
        return [];
    }

    const keepKeys = options?.keepKeys instanceof Set ? options.keepKeys : new Set(Array.isArray(options?.keepKeys) ? options.keepKeys.filter(Boolean) : []);
    const now = Number.isFinite(options?.now) ? options.now : Date.now();
    if (!canReadReceiptsHideMessages(messages, now)) {
        return [];
    }
    const byKey = indexMessagesByKey(messages, { keep: 'last' });
    const coverage = makeReceiptCoverage(messages, byKey, chatPK, peerChatPK);
    if (!coverage.peer.receipts.length && !coverage.own.receipts.length) {
        return [];
    }

    const hidden = [];
    const candidates = [];
    for (const msg of messages) {
        if (!hasAnyMsgKey(msg, keepKeys) && isServerConfirmedMsg(msg) && !isControlMsg(msg) && !isSystemMsg(msg) && canShowMsg(msg) && msg.ttl != null) {
            const ms = messageOrderMs(msg);
            if (ms != null) {
                candidates.push({ msg, ms, fromPeer: isPeerMsg(msg, chatPK) });
            }
        }
    }
    candidates.sort((a, b) => b.ms - a.ms);
    for (const candidate of candidates) {
        const seenAt = receiptCoverageSeenAt(candidate.fromPeer ? coverage.peer : coverage.own, candidate.ms);
        if (seenAt != null && (getMessageRetention(candidate.msg) === CHAT_RETENTION_SEEN || seenMessageTtlMs(seenAt) <= now)) {
            hidden.push(candidate.msg);
        }
    }
    return hidden;
}

export function filterSeenMessages(messages, chatPK, peerChatPK, options = {}) {
    const hidden = getSeenHiddenMessages(messages, chatPK, peerChatPK, options);
    if (!hidden.length) {
        return messages || [];
    }

    const hiddenKeys = collectMessageKeys(hidden);

    return (messages || []).filter((msg) => !hasAnyMsgKey(msg, hiddenKeys));
}

export function getHiddenDisplayMessages(messages, chatPK, peerChatPK, options = {}) {
    const actionMessages = applyMessageActions(messages);
    if (!hasReadReceipts(actionMessages)) {
        return [];
    }
    return getSeenHiddenMessages(applyMessageRetentionTimeline(actionMessages, options.fallback), chatPK, peerChatPK, options);
}

export function getDisplayMessages(messages, chatPK, peerChatPK, options = {}) {
    const actionMessages = applyMessageActions(messages);
    if (!needsRetentionProjection(actionMessages)) {
        return actionMessages || [];
    }
    return filterSeenMessages(applyMessageRetentionTimeline(actionMessages, options.fallback), chatPK, peerChatPK, options);
}

function actionTarget(msg) {
    return cleanText(msg?.actionTarget) || cleanText(msg?.target) || cleanText(msg?.id);
}

function actionPatch(msg) {
    const {
        id,
        cid,
        ts,
        ttl,
        from,
        pending,
        failed,
        actionId,
        actionOp,
        actionTarget,
        actor,
        target,
        ...payload
    } = msg || {};
    return payload;
}

function indexMessage(indexByKey, msg, index) {
    for (const key of messageKeys(msg)) {
        indexByKey.set(key, index);
    }
}

export function applyMessageActions(messages) {
    if (!Array.isArray(messages) || !messages.length) {
        return messages || [];
    }

    const out = [];
    const indexByKey = new Map();
    let changed = false;

    for (const msg of messages) {
        const op = cleanText(msg?.actionOp) || 'create';
        if (op === 'edit') {
            const target = actionTarget(msg);
            const index = target ? indexByKey.get(target) : null;
            const base = index != null ? out[index] : null;
            if (base && base.s && msg?.s === base.s) {
                const next = {
                    ...base,
                    ...actionPatch(msg),
                    id: base.id,
                    cid: base.cid,
                    s: base.s,
                    from: base.from,
                    ts: base.ts,
                    ttl: base.ttl,
                    ...(base.reactions ? { reactions: base.reactions } : {}),
                    editedAt: msg.ts ?? base.editedAt,
                };
                out[index] = next;
                indexMessage(indexByKey, next, index);
            }
            changed = true;
            continue;
        }

        if (op === 'pay_confirm') {
            const target = actionTarget(msg);
            const index = target ? indexByKey.get(target) : null;
            const base = index != null ? out[index] : null;
            const tx = cleanText(msg?.tx);
            if (base?.t === 'req' && tx && base.s && msg?.s && msg.s !== base.s) {
                const next = {
                    ...base,
                    tx,
                    paidBy: msg.s,
                    paidAt: msg.ts ?? base.paidAt,
                };
                out[index] = next;
                indexMessage(indexByKey, next, index);
            }
            changed = true;
            continue;
        }

        const index = out.length;
        out.push(msg);
        indexMessage(indexByKey, msg, index);
    }

    if (!changed) {
        return messages;
    }
    return out.filter(Boolean);
}

function replaceSystemMsg(previous, next) {
    return {
        ...next,
        ...(previous?.id ? { id: previous.id } : {}),
        ...(previous?.cid ? { cid: previous.cid } : {}),
    };
}

export function collapseSystemMessages(messages) {
    const collapsed = [];
    let changed = false;
    for (const msg of messages || []) {
        if (isSystemMsg(msg) && isSystemMsg(collapsed[collapsed.length - 1])) {
            collapsed[collapsed.length - 1] = replaceSystemMsg(collapsed[collapsed.length - 1], msg);
            changed = true;
            continue;
        }
        collapsed.push(msg);
    }
    return changed ? collapsed : messages || [];
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
        const next = withCachedMessageRetention(msg, retention);
        if (next !== msg) {
            changed = true;
        }
        return next;
    });

    return changed ? next : messages;
}

function withCachedMessageRetention(msg, retention) {
    const next = withMessageRetention(msg, retention);
    if (next === msg) {
        return msg;
    }

    const nextRetention = next.retention;
    let byRetention = retainedMessageCache.get(msg);
    if (!byRetention) {
        byRetention = new Map();
        retainedMessageCache.set(msg, byRetention);
    }

    const cached = byRetention.get(nextRetention);
    if (cached) {
        return cached;
    }

    byRetention.set(nextRetention, next);
    return next;
}
