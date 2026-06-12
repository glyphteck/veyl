import { renderMoney } from '../../money.js';
import { addMessageKeys, collectMessageKeys, keySet, messageHasKey } from '../messagekeys.js';
import { getMessageKey, getMessageOrderMs } from '../state.js';
import { cleanText } from '../../utils/text.js';
import { formatRelativeTime, nextRelativeTimeRefreshMs, timestampMs } from '../../utils/time.js';
import { getMessageRetention, seenMessageTtlMs, ttlMillis } from '../ttl.js';
import { canShowMsg, getSystemMsgText, isReadReceiptMsg, isReactionMsg, isSystemMsg } from './control.js';
import { getAttachmentCaption, getAttachmentTitle, isAttachmentMsgType } from './files.js';
import { formatTextLinks, hasText } from './text.js';

export const CHAT_PREVIEW_TEXT = Object.freeze({
    hidden: '',
    fallback: 'sent a message',
    reactionSelf: 'you liked a message',
    reactionPeer: 'liked your message',
    readSelf: 'you saw their message',
    readPeer: 'has seen your message',
    settingsSelfSeen: 'you changed messages to delete after seen',
    settingsPeerSeen: 'changed messages to delete after seen',
    settingsSelf24h: 'you changed messages to 24h after seen',
    settingsPeer24h: 'changed messages to 24h after seen',
    settingsSelf: 'you changed chat settings',
    settingsPeer: 'changed chat settings',
});

export const CHAT_PREVIEW_ACTIVITY_OPENED = 'opened';

function fromSelf(preview, chatPK) {
    const sender = preview?.from || preview?.s;
    return !!sender && !!chatPK && sender === chatPK;
}

function showPreviewText(settings) {
    return settings?.showChatPreviews !== false;
}

export function canRenderChatPreview(preview) {
    return !!preview && (canShowMsg(preview) || hasChatPreviewActivity(preview) || isReadReceiptMsg(preview) || isReactionMsg(preview));
}

function canReplaceChatPreview(preview, chatPK) {
    if (!canRenderChatPreview(preview)) {
        return false;
    }
    return !(isReadReceiptMsg(preview) && fromSelf(preview, chatPK));
}

function settingsPreviewText(preview, self) {
    if (!isSystemMsg(preview)) {
        return '';
    }
    if (preview.retention === 'seen') {
        return self ? CHAT_PREVIEW_TEXT.settingsSelfSeen : CHAT_PREVIEW_TEXT.settingsPeerSeen;
    }
    if (preview.retention === '24h') {
        return self ? CHAT_PREVIEW_TEXT.settingsSelf24h : CHAT_PREVIEW_TEXT.settingsPeer24h;
    }
    return self ? CHAT_PREVIEW_TEXT.settingsSelf : CHAT_PREVIEW_TEXT.settingsPeer;
}

function attachmentPreviewText(preview, self) {
    const prefix = self ? 'you sent' : 'sent';
    if (preview.t === 'img') return `${prefix} an image`;
    if (preview.t === 'gif') return `${prefix} a gif`;
    if (preview.t === 'm4a') return self ? 'you sent audio' : 'sent audio';
    if (preview.t === 'mp4') return `${prefix} a video`;
    return `${prefix} a file`;
}

function requestPreviewText(preview, self, chatPK, settings, btcPrice) {
    const amount = Number(preview.a || 0);
    const formattedAmount = renderMoney(amount, settings?.moneyFormat || 'btc', btcPrice);
    if (preview.tx) {
        if (preview.paidBy && preview.paidBy === chatPK) {
            return `you paid ${formattedAmount}`;
        }
        return self ? `you received ${formattedAmount}` : `received ${formattedAmount}`;
    }
    return self ? `you requested ${formattedAmount}` : `requested ${formattedAmount}`;
}

export function getChatPreviewSourceKey(preview) {
    return cleanText(preview?.sourceKey) || cleanText(getMessageKey(preview));
}

export function getChatPreviewSourceTs(preview) {
    return timestampMs(preview?.sourceTs, null, { positive: true }) ?? timestampMs(preview?.ts, null, { positive: true }) ?? getMessageOrderMs(preview);
}

export function getChatPreviewActivityAt(preview) {
    return timestampMs(preview?.activity?.at, null, { positive: true });
}

export function hasChatPreviewActivity(preview) {
    return cleanText(preview?.activity?.kind) === CHAT_PREVIEW_ACTIVITY_OPENED && getChatPreviewActivityAt(preview) != null;
}

export function chatPreviewContentExpired(preview, now = Date.now()) {
    const until = timestampMs(preview?.contentUntil, null, { positive: true });
    return until != null && until <= now;
}

function chatPreviewTtlExpired(preview, now = Date.now()) {
    const ttl = ttlMillis(preview?.ttl);
    return ttl != null && ttl <= now;
}

export function dropExpiredChatPreviewContent(preview, now = Date.now()) {
    if (!hasChatPreviewActivity(preview) || (!chatPreviewContentExpired(preview, now) && !chatPreviewTtlExpired(preview, now))) {
        return preview;
    }
    const sourceKey = getChatPreviewSourceKey(preview);
    const sourceTs = getChatPreviewSourceTs(preview);
    const sender = cleanText(preview?.from || preview?.s);
    const activityAt = getChatPreviewActivityAt(preview);
    const activityBy = cleanText(preview?.activity?.by);
    return {
        ...(sender ? { s: sender, from: sender } : {}),
        ...(sourceKey ? { sourceKey } : {}),
        ...(Number.isFinite(sourceTs) ? { sourceTs, ts: sourceTs } : {}),
        activity: {
            kind: CHAT_PREVIEW_ACTIVITY_OPENED,
            at: activityAt,
            ...(activityBy ? { by: activityBy } : {}),
        },
    };
}

export function chatPreviewContentUntilForRead(preview, readAt) {
    const readMs = timestampMs(readAt, null, { positive: true });
    if (readMs == null) {
        return null;
    }
    return getMessageRetention(preview) === 'seen' ? readMs : seenMessageTtlMs(readMs);
}

export function withChatPreviewActivity(preview, activity = {}) {
    if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
        return null;
    }
    const kind = cleanText(activity.kind);
    const at = timestampMs(activity.at, null, { positive: true });
    if (!kind || at == null) {
        return preview;
    }
    const by = cleanText(activity.by);
    const sourceKey = cleanText(activity.sourceKey) || getChatPreviewSourceKey(preview);
    const sourceTs = timestampMs(activity.sourceTs, null, { positive: true }) ?? getChatPreviewSourceTs(preview);
    const contentUntil = timestampMs(activity.contentUntil, null, { positive: true });
    const { activity: _oldActivity, contentUntil: _oldContentUntil, sourceKey: _oldSourceKey, sourceTs: _oldSourceTs, ...rest } = preview;
    return {
        ...rest,
        ...(sourceKey ? { sourceKey } : {}),
        ...(Number.isFinite(sourceTs) ? { sourceTs } : {}),
        ...(contentUntil != null ? { contentUntil } : {}),
        activity: {
            kind,
            at,
            ...(by ? { by } : {}),
        },
    };
}

export function withChatPreviewOpened(preview, target, openedAt, by, chatPK) {
    if (!preview || !target) {
        return null;
    }
    const keys = collectMessageKeys(target);
    if (!chatPreviewHasKey(preview, keys)) {
        return null;
    }
    const at = timestampMs(openedAt, null, { positive: true });
    if (at == null) {
        return null;
    }
    const self = fromSelf(preview, chatPK);
    return withChatPreviewActivity(preview, {
        kind: CHAT_PREVIEW_ACTIVITY_OPENED,
        at,
        by,
        sourceKey: getChatPreviewSourceKey(preview),
        sourceTs: getChatPreviewSourceTs(preview),
        ...(!self ? { contentUntil: chatPreviewContentUntilForRead(preview, at) } : {}),
    });
}

function activityPreviewText(preview, now) {
    const at = getChatPreviewActivityAt(preview) ?? (isReadReceiptMsg(preview) ? timestampMs(preview?.ts, null, { positive: true }) : null);
    if (at == null) {
        return '';
    }
    return `opened ${formatRelativeTime(at, now)}`;
}

function contentPreviewText(preview, chatPK, settings, btcPrice) {
    if (!canShowMsg(preview)) return '';

    const self = fromSelf(preview, chatPK);
    if (isSystemMsg(preview)) {
        return settingsPreviewText(preview, self) || getSystemMsgText(preview);
    }
    if (preview.t === 'txt' && typeof preview.c === 'string') {
        return formatTextLinks(preview.c);
    }
    if (isAttachmentMsgType(preview?.t)) return attachmentPreviewText(preview, self);
    if (preview.t === 'req') {
        return requestPreviewText(preview, self, chatPK, settings, btcPrice);
    }
    if (typeof preview.c === 'string') return preview.c;
    if (typeof preview.text === 'string') return preview.text;
    return self ? `you ${CHAT_PREVIEW_TEXT.fallback}` : CHAT_PREVIEW_TEXT.fallback;
}

export function chatPreviewWantsAttention(preview, chatPK) {
    if (!preview || fromSelf(preview, chatPK)) {
        return false;
    }
    if (isReactionMsg(preview) || isReadReceiptMsg(preview)) {
        return false;
    }
    return canShowMsg(preview);
}

export function getReplyPreview(msg) {
    if (!msg || typeof msg !== 'object') {
        return '';
    }
    if (msg.t === 'txt' && hasText(msg.c)) {
        return formatTextLinks(msg.c).trim();
    }
    if (msg.t === 'req') {
        return msg.tx ? 'payment' : 'payment request';
    }
    if (isAttachmentMsgType(msg?.t)) {
        return getAttachmentCaption(msg) || getAttachmentTitle(msg);
    }
    return '';
}

export function getMsgPreview(preview, chatPK, settings, btcPrice, options = {}) {
    if (!preview) return '';
    if (!showPreviewText(settings)) return CHAT_PREVIEW_TEXT.hidden;
    if (typeof preview === 'string') return preview;
    if (!canRenderChatPreview(preview)) return '';

    const now = timestampMs(options?.now, Date.now(), { parseString: true });
    const self = fromSelf(preview, chatPK);
    if (isReadReceiptMsg(preview)) {
        return activityPreviewText(preview, now) || (self ? CHAT_PREVIEW_TEXT.readSelf : CHAT_PREVIEW_TEXT.readPeer);
    }
    if (isReactionMsg(preview)) {
        return self ? CHAT_PREVIEW_TEXT.reactionSelf : CHAT_PREVIEW_TEXT.reactionPeer;
    }

    const activity = activityPreviewText(preview, now);
    const content = chatPreviewContentExpired(preview, now) ? '' : contentPreviewText(preview, chatPK, settings, btcPrice);
    if (activity && (self || !content)) {
        return activity;
    }
    if (content && !self) return content;
    return content || activity;
}

export function latestPreviewMessage(messages, options = {}) {
    for (let index = (messages?.length || 0) - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (canReplaceChatPreview(message, options?.chatPK)) {
            return message;
        }
    }
    return null;
}

export function previewValueKey(message) {
    return [
        getMessageKey(message),
        message?.sourceKey,
        timestampMs(message?.sourceTs, null),
        message?.id,
        message?.t,
        message?.c,
        message?.tx,
        message?.sys,
        message?.retention,
        message?.target,
        message?.upto,
        message?.emoji,
        message?.actionOp,
        message?.actionTarget,
        message?.activity?.kind,
        timestampMs(message?.activity?.at, null),
        message?.activity?.by,
        timestampMs(message?.contentUntil, null),
        timestampMs(message?.ttl, null),
        message?.pending === true ? 'pending' : '',
        message?.failed === true ? 'failed' : '',
    ]
        .map((part) => part ?? '')
        .join(':');
}

function previewActionTargetsKey(message, key) {
    const targetKey = cleanText(key);
    if (!targetKey || (!isReadReceiptMsg(message) && !isReactionMsg(message))) {
        return false;
    }

    return [message?.target, message?.upto, message?.actionTarget]
        .map(cleanText)
        .some((target) => target === targetKey);
}

export function chatPreviewHasKey(preview, keys) {
    const nextKeys = keySet(keys);
    if (!preview || !nextKeys.size) {
        return false;
    }
    if (messageHasKey(preview, nextKeys)) {
        return true;
    }
    const sourceKey = getChatPreviewSourceKey(preview);
    if (sourceKey && nextKeys.has(sourceKey)) {
        return true;
    }
    for (const key of nextKeys) {
        if (previewActionTargetsKey(preview, key)) {
            return true;
        }
    }
    return false;
}

function batchCoversPreviewKey(batch, key) {
    if (!batch || !key) {
        return false;
    }
    if (batch.empty || batch.expiredKeys?.has?.(key) || batch.deletedKeys?.has?.(key)) {
        return true;
    }

    const ms = getMessageOrderMs({ cid: key });
    return Number.isFinite(ms) && Number.isFinite(batch.firstMs) && Number.isFinite(batch.lastMs) && ms >= batch.firstMs && ms <= batch.lastMs;
}

export function getPreviewDropSync({ chatId, chatPreviewKey, messages, serverBatch, deletedKeys, droppedKeys }) {
    const visibleKeys = new Set();
    for (const message of messages || []) {
        if (canRenderChatPreview(message)) {
            addMessageKeys(visibleKeys, message);
        }
    }
    if (visibleKeys.has(chatPreviewKey)) {
        return null;
    }

    const nextDroppedKeys = new Set([...keySet(serverBatch?.expiredKeys), ...keySet(serverBatch?.deletedKeys), ...keySet(deletedKeys), ...keySet(droppedKeys)]);
    if (!nextDroppedKeys.has(chatPreviewKey) && !batchCoversPreviewKey(serverBatch, chatPreviewKey)) {
        return null;
    }

    nextDroppedKeys.add(chatPreviewKey);
    return {
        droppedKeys: nextDroppedKeys,
        replacement: null,
        syncKey: `${chatId}:${chatPreviewKey}:${[...nextDroppedKeys].sort().join('|')}:`,
    };
}

function currentPreviewTargetsReplacement(currentPreview, replacement) {
    const replacementKey = getMessageKey(replacement);
    return !!replacementKey && previewActionTargetsKey(currentPreview, replacementKey);
}

export function nextChatPreviewRefreshMs(preview, now = Date.now()) {
    if (!preview) {
        return null;
    }
    const times = [];
    const contentUntil = timestampMs(preview.contentUntil, null, { positive: true });
    if (contentUntil != null && contentUntil > now) {
        times.push(contentUntil);
    }
    const ttl = ttlMillis(preview.ttl);
    if (ttl != null && ttl > now) {
        times.push(ttl);
    }
    for (const relativeSource of [getChatPreviewActivityAt(preview), getChatPreviewSourceTs(preview)]) {
        const relativeRefresh = nextRelativeTimeRefreshMs(relativeSource, now);
        if (relativeRefresh != null && relativeRefresh > now) {
            times.push(relativeRefresh);
        }
    }
    const next = Math.min(...times);
    return Number.isFinite(next) ? next : null;
}

export function getPreviewUpdateSync({ chatId, chatPreviewKey, chatPreview, chatPK, messages }) {
    const replacement = latestPreviewMessage(messages, { chatPK });
    const previewKeys = new Set([chatPreviewKey]);
    const repairsOwnReadReceipt = isReadReceiptMsg(chatPreview) && fromSelf(chatPreview, chatPK) && currentPreviewTargetsReplacement(chatPreview, replacement);
    if (!replacement || (!messageHasKey(replacement, previewKeys) && !previewActionTargetsKey(replacement, chatPreviewKey) && !repairsOwnReadReceipt)) {
        return null;
    }

    const nextReplacement =
        isReadReceiptMsg(replacement) && previewActionTargetsKey(replacement, chatPreviewKey)
            ? withChatPreviewOpened(chatPreview, chatPreviewKey, replacement.ts, replacement.from || replacement.s, chatPK) || replacement
            : replacement;

    return {
        replacement: nextReplacement,
        syncKey: `${chatId}:${chatPreviewKey}:${previewValueKey(nextReplacement)}`,
    };
}
