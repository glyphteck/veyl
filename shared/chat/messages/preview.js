import { renderMoney } from '../../money.js';
import { canShowMsg, getSystemMsgText, isSystemMsg } from './control.js';
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
