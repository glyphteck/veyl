export const MESSAGE_PREVIEW_LABEL = 'preview';
export const MESSAGE_PREVIEW_CACHE_LABEL = 'preview-v2';
export const MESSAGE_PREVIEW_MIME = 'image/jpeg';
export const MESSAGE_PREVIEW_EXT = 'jpg';
export const MESSAGE_PREVIEW_COMPRESS = 0.94;
export const MESSAGE_PREVIEW_MIN_WIDTH = 960;
export const MESSAGE_PREVIEW_MAX_EDGE = 1600;

export function makeMessagePreviewMedia(message, mimeType = MESSAGE_PREVIEW_MIME) {
    const path = typeof message?.p === 'string' ? message.p.trim() : '';
    const fileKey = typeof message?.k === 'string' ? message.k.trim() : '';
    if (!path || !fileKey || path.startsWith('local:') || fileKey === 'local') {
        return null;
    }
    return {
        ...message,
        t: 'img',
        m: mimeType || MESSAGE_PREVIEW_MIME,
        k: `${fileKey}:${MESSAGE_PREVIEW_CACHE_LABEL}`,
    };
}

export function getMessagePreviewCacheKey(peerChatPK, message) {
    const msg = message || peerChatPK;
    return msg?.p && msg?.k ? `${MESSAGE_PREVIEW_CACHE_LABEL}:${msg.p}:${msg.k}` : '';
}

export function getMessagePreviewFileName(fileName) {
    const base = String(fileName || 'video').replace(/\.[^.]+$/, '') || 'video';
    return `${base}-${MESSAGE_PREVIEW_LABEL}.${MESSAGE_PREVIEW_EXT}`;
}
