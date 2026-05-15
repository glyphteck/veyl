'use client';

import { preloadMsgImage } from './usemsgimage';
import { preloadMsgVideo } from './videomediacache';

export function preloadMessageMedia(peerChatPK, msg, readMessageFile, options = {}) {
    if (msg?.t === 'img') {
        return preloadMsgImage(peerChatPK, msg, readMessageFile, options).catch(() => null);
    }
    if (msg?.t === 'mp4') {
        return preloadMsgVideo(peerChatPK, msg, readMessageFile, options).catch(() => null);
    }
    return Promise.resolve(null);
}
