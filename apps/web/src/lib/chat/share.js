'use client';

import { isImageAttachmentMsg } from '@veyl/shared/chat/messages';
import { readCachedMsgAudioUrl } from './audiocache';
import { readCachedMsgImageUrl } from './useimage';
import { readCachedMsgVideoUrl } from './videocache';

async function objectUrlBlob(url) {
    if (!url || typeof fetch !== 'function') {
        return null;
    }
    const response = await fetch(url);
    if (!response?.ok) {
        return null;
    }
    return response.blob();
}

export async function readCachedShareAttachmentData(msg, peerChatPK) {
    if (msg?.localData != null) {
        return msg.localData;
    }

    let url = '';
    if (isImageAttachmentMsg(msg)) {
        url = readCachedMsgImageUrl(msg);
    } else if (msg?.t === 'mp4') {
        url = readCachedMsgVideoUrl(peerChatPK, msg);
    } else if (msg?.t === 'm4a') {
        url = readCachedMsgAudioUrl(peerChatPK, msg);
    }
    return objectUrlBlob(url);
}
