import { CHAT_MESSAGE_PREVIEW_COMPRESS, CHAT_MESSAGE_PREVIEW_MAX_EDGE, CHAT_MESSAGE_PREVIEW_MIN_WIDTH } from '../config.js';
import { cleanText } from '../utils/text.js';
import { hasStoredFileRef } from './messages/files.js';

export const MESSAGE_PREVIEW_LABEL = 'preview';
export const MESSAGE_PREVIEW_CACHE_LABEL = 'preview-v2';
export const MESSAGE_PREVIEW_MIME = 'image/jpeg';
export const MESSAGE_PREVIEW_EXT = 'jpg';
export const MESSAGE_PREVIEW_COMPRESS = CHAT_MESSAGE_PREVIEW_COMPRESS;
export const MESSAGE_PREVIEW_MIN_WIDTH = CHAT_MESSAGE_PREVIEW_MIN_WIDTH;
export const MESSAGE_PREVIEW_MAX_EDGE = CHAT_MESSAGE_PREVIEW_MAX_EDGE;

export function makeMessagePreviewMedia(message, mimeType = MESSAGE_PREVIEW_MIME) {
    if (!hasStoredFileRef(message)) {
        return null;
    }
    const fileKey = cleanText(message?.k);
    return {
        ...message,
        t: 'img',
        m: mimeType || MESSAGE_PREVIEW_MIME,
        k: `${fileKey}:${MESSAGE_PREVIEW_CACHE_LABEL}`,
    };
}

export function getMessagePreviewCacheKey(peerChatPK, message) {
    const msg = message || peerChatPK;
    const path = cleanText(msg?.p);
    const fileKey = cleanText(msg?.k);
    return path && fileKey ? `${MESSAGE_PREVIEW_CACHE_LABEL}:${path}:${fileKey}` : '';
}

export function getMessagePreviewFileName(fileName) {
    const base = String(fileName || 'video').replace(/\.[^.]+$/, '') || 'video';
    return `${base}-${MESSAGE_PREVIEW_LABEL}.${MESSAGE_PREVIEW_EXT}`;
}
