import { getMessageKey } from '@veyl/shared/chat/state';
import { isImageAttachmentMsg } from '@veyl/shared/chat/messages';

export function isMediaViewerMsg(msg) {
    return isImageAttachmentMsg(msg) || msg?.t === 'mp4';
}

export function getMediaViewerKey(peerChatPK, msg) {
    if (!isMediaViewerMsg(msg)) {
        return '';
    }

    const fileKey = msg?.p || msg?.localUri || msg?.k;
    const msgKey = getMessageKey(msg);
    const key = fileKey || msgKey;

    return key ? `${peerChatPK || ''}:${key}` : '';
}
