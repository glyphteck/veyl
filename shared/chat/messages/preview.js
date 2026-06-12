import { renderMoney } from '../../money.js';
import { addMessageKeys, keySet, messageHasKey } from '../messagekeys.js';
import { getMessageKey, getMessageOrderMs } from '../state.js';
import { cleanText } from '../../utils/text.js';
import { timestampMs } from '../../utils/time.js';
import { canShowMsg, getSystemMsgText, isReadReceiptMsg, isReactionMsg, isSystemMsg } from './control.js';
import { getAttachmentCaption, getAttachmentTitle, isAttachmentMsgType } from './files.js';
import { hasText } from './text.js';

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

function fromSelf(preview, chatPK) {
    const sender = preview?.from || preview?.s;
    return !!sender && !!chatPK && sender === chatPK;
}

function showPreviewText(settings) {
    return settings?.showChatPreviews !== false;
}

export function canRenderChatPreview(preview) {
    return !!preview && (canShowMsg(preview) || isReadReceiptMsg(preview) || isReactionMsg(preview));
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
        return msg.c.trim();
    }
    if (msg.t === 'req') {
        return msg.tx ? 'payment' : 'payment request';
    }
    if (isAttachmentMsgType(msg?.t)) {
        return getAttachmentCaption(msg) || getAttachmentTitle(msg);
    }
    return '';
}

export function getMsgPreview(preview, chatPK, settings, btcPrice) {
    if (!preview) return '';
    if (!showPreviewText(settings)) return CHAT_PREVIEW_TEXT.hidden;
    if (typeof preview === 'string') return preview;
    if (!canRenderChatPreview(preview)) return '';

    const self = fromSelf(preview, chatPK);
    if (isReadReceiptMsg(preview)) {
        return self ? CHAT_PREVIEW_TEXT.readSelf : CHAT_PREVIEW_TEXT.readPeer;
    }
    if (isReactionMsg(preview)) {
        return self ? CHAT_PREVIEW_TEXT.reactionSelf : CHAT_PREVIEW_TEXT.reactionPeer;
    }
    if (isSystemMsg(preview)) {
        return settingsPreviewText(preview, self) || getSystemMsgText(preview);
    }
    if (preview.t === 'txt' && typeof preview.c === 'string') {
        return preview.c;
    }
    if (isAttachmentMsgType(preview?.t)) return attachmentPreviewText(preview, self);
    if (preview.t === 'req') {
        return requestPreviewText(preview, self, chatPK, settings, btcPrice);
    }
    if (typeof preview.c === 'string') return preview.c;
    if (typeof preview.text === 'string') return preview.text;
    return self ? `you ${CHAT_PREVIEW_TEXT.fallback}` : CHAT_PREVIEW_TEXT.fallback;
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

export function getPreviewUpdateSync({ chatId, chatPreviewKey, chatPreview, chatPK, messages }) {
    const replacement = latestPreviewMessage(messages, { chatPK });
    const previewKeys = new Set([chatPreviewKey]);
    const repairsOwnReadReceipt = isReadReceiptMsg(chatPreview) && fromSelf(chatPreview, chatPK) && currentPreviewTargetsReplacement(chatPreview, replacement);
    if (!replacement || (!messageHasKey(replacement, previewKeys) && !previewActionTargetsKey(replacement, chatPreviewKey) && !repairsOwnReadReceipt)) {
        return null;
    }

    return {
        replacement,
        syncKey: `${chatId}:${chatPreviewKey}:${previewValueKey(replacement)}`,
    };
}
