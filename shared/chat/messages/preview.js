import { renderMoney } from '../../utils.js';
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

export function getMsgPreview(lastMsg, chatPK, settings, btcPrice) {
    if (!lastMsg) return '';
    if (typeof lastMsg === 'string') return lastMsg;
    if (!canShowMsg(lastMsg)) return '';
    if (isSystemMsg(lastMsg)) return getSystemMsgText(lastMsg);
    if (lastMsg.t === 'txt' && typeof lastMsg.c === 'string') return lastMsg.c;
    if (isAttachmentMsgType(lastMsg?.t)) {
        if (lastMsg.t === 'img') return 'sent an image';
        if (lastMsg.t === 'mp3') return 'sent audio';
        if (lastMsg.t === 'mp4') return 'sent a video';
        return 'sent a file';
    }
    if (lastMsg.t === 'req') {
        const amount = Number(lastMsg.a || 0);
        const formattedAmount = renderMoney(amount, settings?.moneyFormat || 'btc', btcPrice);
        return lastMsg.tx ? `received ${formattedAmount}` : `requested ${formattedAmount}`;
    }
    if (typeof lastMsg.c === 'string') return lastMsg.c;
    if (typeof lastMsg.text === 'string') return lastMsg.text;
    return 'sent a message';
}
