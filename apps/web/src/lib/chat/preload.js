'use client';

import { preloadMsgImage } from './useimage';
import { preloadMsgVideo } from './videocache';

export function preloadMessageMedia(peerChatPK, msg, readMessageFile, options = {}) {
    if (msg?.t === 'img') {
        return preloadMsgImage(peerChatPK, msg, readMessageFile, options).catch(() => null);
    }
    if (msg?.t === 'mp4') {
        return preloadMsgVideo(peerChatPK, msg, readMessageFile, options).catch(() => null);
    }
    return Promise.resolve(null);
}
