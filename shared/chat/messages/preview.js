import { renderMoney } from '../../money.js';
import { addMessageKeys, keySet, messageHasKey } from '../messagekeys.js';
import { getMessageKey, getMessageOrderMs } from '../state.js';
import { timestampMs } from '../../utils/time.js';
import { canShowMsg, getSystemMsgText, isControlMsg, isSystemMsg } from './control.js';
import { getAttachmentCaption, getAttachmentTitle, isAttachmentMsgType } from './files.js';
import { hasText } from './text.js';

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
    if (typeof preview === 'string') return preview;
    if (!canShowMsg(preview)) return '';
    if (isSystemMsg(preview)) return getSystemMsgText(preview);
    if (preview.t === 'txt' && typeof preview.c === 'string') return preview.c;
    if (isAttachmentMsgType(preview?.t)) {
        if (preview.t === 'img') return 'sent an image';
        if (preview.t === 'mp3') return 'sent audio';
        if (preview.t === 'mp4') return 'sent a video';
        return 'sent a file';
    }
    if (preview.t === 'req') {
        const amount = Number(preview.a || 0);
        const formattedAmount = renderMoney(amount, settings?.moneyFormat || 'btc', btcPrice);
        return preview.tx ? `received ${formattedAmount}` : `requested ${formattedAmount}`;
    }
    if (typeof preview.c === 'string') return preview.c;
    if (typeof preview.text === 'string') return preview.text;
    return 'sent a message';
}

export function latestPreviewMessage(messages) {
    for (let index = (messages?.length || 0) - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (canShowMsg(message) && !isControlMsg(message)) {
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
        timestampMs(message?.ttl, null),
        message?.pending === true ? 'pending' : '',
        message?.failed === true ? 'failed' : '',
    ]
        .map((part) => part ?? '')
        .join(':');
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
        if (canShowMsg(message) && !isControlMsg(message)) {
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

export function getPreviewUpdateSync({ chatId, chatPreviewKey, messages }) {
    const replacement = latestPreviewMessage(messages);
    if (!replacement || !messageHasKey(replacement, new Set([chatPreviewKey]))) {
        return null;
    }

    return {
        replacement,
        syncKey: `${chatId}:${chatPreviewKey}:${previewValueKey(replacement)}`,
    };
}
