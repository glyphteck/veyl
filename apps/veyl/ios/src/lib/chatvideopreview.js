import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { getCachedMsgImage, loadCachedMsgImage } from '@/lib/msgimagecache';
import { mark } from '@/lib/diagnostics';
import {
    getMessagePreviewCacheKey,
    getMessagePreviewFileName,
    MESSAGE_PREVIEW_COMPRESS,
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

function getVideoPreviewTimeMs(durationSeconds) {
    const duration = Number(durationSeconds);
    if (!Number.isFinite(duration) || duration <= 0.2) {
        return 0;
    }
    if (duration < 1) {
        return Math.max(0, Math.round(duration * 350));
    }
    return Math.round(Math.min(Math.max(duration * 100, 350), 1000));
}

function getResizeSize(width, height, maxEdge) {
    const sourceWidth = Number(width);
    const sourceHeight = Number(height);
    const edge = Number(maxEdge);
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0 || !Number.isFinite(edge) || edge <= 0) {
        return null;
    }

    const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
    if (scale >= 1) {
        return null;
    }

    return {
        width: Math.max(1, Math.round(sourceWidth * scale)),
        height: Math.max(1, Math.round(sourceHeight * scale)),
    };
}

export async function generateVideoPreviewBytes(uri, maxWidth = MESSAGE_PREVIEW_MAX_EDGE, msg = null) {
    if (!uri) {
        return null;
    }

    const maxEdge = Math.min(Math.max(Number(maxWidth) || MESSAGE_PREVIEW_MIN_WIDTH, MESSAGE_PREVIEW_MIN_WIDTH), MESSAGE_PREVIEW_MAX_EDGE);
    const time = getVideoPreviewTimeMs(msg?.d);
    mark('chat.video.preview.generate.start', { time, maxEdge });
    const thumbnail = await VideoThumbnails.getThumbnailAsync(uri, {
        time,
        quality: MESSAGE_PREVIEW_COMPRESS,
    });
    const resize = getResizeSize(thumbnail?.width, thumbnail?.height, maxEdge);
    let context = null;
    let rendered = null;
    try {
        context = ImageManipulator.manipulate(thumbnail.uri);
        if (resize) {
            context.resize(resize);
        }
        rendered = await context.renderAsync();
        const saved = await rendered.saveAsync({
            compress: MESSAGE_PREVIEW_COMPRESS,
            format: SaveFormat.JPEG,
        });
        const bytes = await new File(saved.uri).bytes();
        mark('chat.video.preview.generate.done', { bytes: bytes?.byteLength || 0, width: saved?.width || thumbnail?.width || 0, height: saved?.height || thumbnail?.height || 0 });
        return bytes;
    } finally {
        rendered?.release?.();
        context?.release?.();
    }
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
                const bytes = await generateVideoPreviewBytes(uri, getVideoPreviewMaxWidth(width), msg);
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
