import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';
import { getCachedMsgImage, loadCachedMsgImage } from '@/lib/msgimagecache';
import {
    getMessagePreviewCacheKey,
    getMessagePreviewFileName,
    MESSAGE_PREVIEW_COMPRESS,
    MESSAGE_PREVIEW_EXT,
    MESSAGE_PREVIEW_MAX_EDGE,
    MESSAGE_PREVIEW_MIN_WIDTH,
    MESSAGE_PREVIEW_MIME,
} from '@glyphteck/shared/chat/previews';

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

async function readUriBytes(uri) {
    const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
    });
    return new Uint8Array(Buffer.from(base64, 'base64'));
}

function getVideoPreviewTime(duration) {
    const value = Number(duration);
    if (!Number.isFinite(value) || value <= 0.2) {
        return 0;
    }
    if (value < 1) {
        return Math.max(0, value * 0.35);
    }
    return Math.min(Math.max(value * 0.1, 0.35), 1);
}

function loadVideoPreviewPlayer(uri) {
    return new Promise((resolve, reject) => {
        if (!uri) {
            reject(new Error('video preview unavailable'));
            return;
        }

        let done = false;
        let sourceSub = null;
        let statusSub = null;
        let timeout = null;
        const player = createVideoPlayer(null);

        const finish = (error, meta = null) => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timeout);
            sourceSub?.remove?.();
            statusSub?.remove?.();
            if (error) {
                player.release?.();
                reject(error);
                return;
            }
            resolve({ player, meta });
        };

        player.audioMixingMode = 'mixWithOthers';
        player.muted = true;
        timeout = setTimeout(() => finish(new Error('video preview unavailable')), 5000);
        sourceSub = player.addListener('sourceLoad', (event) => finish(null, { duration: Number(event?.duration) || 0 }));
        statusSub = player.addListener('statusChange', (event) => {
            if (event?.status === 'error') {
                finish(new Error(event?.error?.message || 'video preview unavailable'));
            }
        });
        Promise.resolve(player.replaceAsync({ uri })).catch((error) => finish(error || new Error('video preview unavailable')));
    });
}

async function generateVideoPreviewBytes(uri, maxWidth) {
    let loaded = null;
    let thumbnail = null;
    let rendered = null;
    let savedUri = '';
    try {
        loaded = await loadVideoPreviewPlayer(uri);
        const thumbnails = await loaded.player.generateThumbnailsAsync(getVideoPreviewTime(loaded.meta?.duration), { maxWidth });
        thumbnail = thumbnails?.[0] || null;
        if (!thumbnail) {
            throw new Error('video preview unavailable');
        }
        rendered = await ImageManipulator.manipulate(thumbnail).renderAsync();
        const saved = await rendered.saveAsync({
            compress: MESSAGE_PREVIEW_COMPRESS,
            format: SaveFormat.JPEG,
        });
        savedUri = saved?.uri || '';
        return await readUriBytes(savedUri);
    } finally {
        await FileSystem.deleteAsync(savedUri, { idempotent: true }).catch(() => {});
        rendered?.release?.();
        thumbnail?.release?.();
        loaded?.player?.release?.();
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
                return cachedBytes;
            }
            if (!uri) {
                throw new Error('video preview pending');
            }
            const bytes = await generateVideoPreviewBytes(uri, getVideoPreviewMaxWidth(width));
            if (bytes?.byteLength) {
                void writeMessagePreview?.(msg, bytes, { mimeType: MESSAGE_PREVIEW_MIME }).catch(() => {});
            }
            return bytes;
        },
        {
            fileName: getMessagePreviewFileName(getPreviewSourceName(msg)),
            defaultExt: MESSAGE_PREVIEW_EXT,
            defer: true,
        }
    ).then(normalizePreviewUri);
}
