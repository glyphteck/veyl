import { getCachedMsgImage, loadCachedMsgImage } from '@/lib/msgimagecache';
import { mark } from '@/lib/diagnostics';
import {
    getMessagePreviewCacheKey,
    getMessagePreviewFileName,
    MESSAGE_PREVIEW_EXT,
    MESSAGE_PREVIEW_MAX_EDGE,
    MESSAGE_PREVIEW_MIN_WIDTH,
    MESSAGE_PREVIEW_MIME,
} from '@glyphteck/shared/chat/previews';

const failedPreviewKeys = new Set();

export function normalizePreviewUri(uri) {
    if (typeof uri !== 'string' || !uri) {
        return '';
    }
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `file://${uri}`;
}

export function getCachedVideoPreviewUri(peerChatPK, msg) {
    return normalizePreviewUri(getCachedMsgImage(getMessagePreviewCacheKey(peerChatPK, msg)));
}

export function getVideoPreviewMaxWidth(width = MESSAGE_PREVIEW_MIN_WIDTH) {
    const target = Math.max(Math.ceil((Number(width) || 0) * 3), MESSAGE_PREVIEW_MIN_WIDTH);
    return Math.min(target, MESSAGE_PREVIEW_MAX_EDGE);
}

function getPreviewSourceName(msg) {
    return typeof msg?.n === 'string' && msg.n.trim() ? msg.n.trim() : 'video';
}

export function generateVideoPreviewBytes(uri, maxWidth = MESSAGE_PREVIEW_MAX_EDGE) {
    void uri;
    void maxWidth;
    // Thumbnail generation is disabled until the Expo video path is stable on iOS.
    return Promise.resolve(null);
}

export function loadVideoPreviewUri({ peerChatPK, msg, uri, width, readMessagePreview, writeMessagePreview } = {}) {
    const previewKey = getMessagePreviewCacheKey(peerChatPK, msg);
    if (!previewKey) {
        return Promise.reject(new Error('video preview unavailable'));
    }

    const cached = getCachedVideoPreviewUri(peerChatPK, msg);
    if (cached) {
        return Promise.resolve(cached);
    }

    return loadCachedMsgImage(
        previewKey,
        MESSAGE_PREVIEW_MIME,
        async () => {
            const cachedBytes = await readMessagePreview?.(msg);
            if (cachedBytes?.byteLength) {
                mark('chat.video.preview.cache.hit', {});
                return cachedBytes;
            }
            if (failedPreviewKeys.has(previewKey)) {
                throw new Error('video preview unavailable');
            }
            if (!uri) {
                throw new Error('video preview pending');
            }
            try {
                const bytes = await generateVideoPreviewBytes(uri, getVideoPreviewMaxWidth(width));
                if (bytes?.byteLength) {
                    void writeMessagePreview?.(msg, bytes, { mimeType: MESSAGE_PREVIEW_MIME }).catch(() => {});
                    return bytes;
                }
                throw new Error('video preview unavailable');
            } catch (error) {
                failedPreviewKeys.add(previewKey);
                throw error;
            }
        },
        {
            fileName: getMessagePreviewFileName(getPreviewSourceName(msg)),
            defaultExt: MESSAGE_PREVIEW_EXT,
            defer: true,
        }
    ).then(normalizePreviewUri);
}
