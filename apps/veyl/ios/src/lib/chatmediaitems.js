export function isMediaViewerMsg(msg) {
    return msg?.t === 'img' || msg?.t === 'mp4';
}

export function getMediaViewerKey(peerChatPK, msg) {
    if (!isMediaViewerMsg(msg)) {
        return '';
    }

    const fileKey = msg?.p || msg?.localUri || msg?.k;
    const msgKey = msg?.id || msg?.cid;
    const key = fileKey || msgKey;

    return key ? `${peerChatPK || ''}:${key}` : '';
}
