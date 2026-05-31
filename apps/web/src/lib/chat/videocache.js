'use client';

import { getMessagePreviewCacheKey, MESSAGE_PREVIEW_COMPRESS, MESSAGE_PREVIEW_MAX_EDGE, MESSAGE_PREVIEW_MIME } from '@veyl/shared/chat/previews';
import { hasStoredFileRef, isExpiredAttachmentMsg } from '@veyl/shared/chat/messages';
import { getMessageKey } from '@veyl/shared/chat/state';
import { waitForIdle } from '@veyl/shared/utils/async';
import { createObjectUrlCache, revokeObjectUrl } from './objecturlcache';

const videoCache = createObjectUrlCache({ max: 16 });
const videoPosterCache = createObjectUrlCache({ max: 40 });

export function getVideoCacheKey(peerChatPK, msg) {
    if (msg?.p && msg?.k) {
        return `${msg.p}:${msg.k}`;
    }
    return `${peerChatPK}:${msg?.p || msg?.localUri || ''}:${msg?.k || getMessageKey(msg) || ''}`;
}

export function retainVideo(key) {
    return videoCache.retain(key);
}

export function releaseVideo(key) {
    videoCache.release(key);
}

export function clearMsgVideoCache() {
    videoCache.clear();
    videoPosterCache.clear();
}

export function loadVideoObjectUrl(peerChatPK, msg, readMessageFile, options = {}) {
    if (msg?.t !== 'mp4' || !peerChatPK || !hasStoredFileRef(msg) || typeof readMessageFile !== 'function') {
        return Promise.resolve('');
    }

    const key = getVideoCacheKey(peerChatPK, msg);
    const expired = isExpiredAttachmentMsg(msg);
    const cached = expired ? null : videoCache.getReady(key);
    if (cached?.url) {
        return Promise.resolve(cached.url);
    }

    const pending = expired ? null : videoCache.getPendingPromise(key);
    if (pending) {
        return pending;
    }

    const epoch = videoCache.epoch;
    const task = Promise.resolve(readMessageFile(peerChatPK, msg))
        .then((bytes) => {
            if (!bytes?.byteLength) {
                throw new Error('video unavailable');
            }
            const objectUrl = URL.createObjectURL(new Blob([bytes], { type: msg?.m || 'video/mp4' }));
            if (epoch !== videoCache.epoch) {
                revokeObjectUrl(objectUrl);
                return '';
            }
            return videoCache.setReady(key, objectUrl, options);
        })
        .catch((error) => {
            videoCache.delete(key);
            throw error;
        });

    videoCache.setPending(key, task);
    return task;
}

export function getReadyPoster(key) {
    return videoPosterCache.getReadyUrl(key, { touch: true });
}

function setReadyPoster(key, url, options = {}) {
    return videoPosterCache.setReady(key, url, { ...options, touch: true });
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

function drawVideoPoster(src) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        let settled = false;
        let timeout = null;
        let targetTime = 0;

        const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            video.removeAttribute('src');
            video.load();
        };

        const fail = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        const finish = () => {
            if (settled || !video.videoWidth || !video.videoHeight) return;
            settled = true;
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, MESSAGE_PREVIEW_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            const context = canvas.getContext('2d');
            if (!context) {
                cleanup();
                reject(new Error('video poster unavailable'));
                return;
            }
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
                async (blob) => {
                    cleanup();
                    if (!blob) {
                        reject(new Error('video poster unavailable'));
                        return;
                    }
                    try {
                        const bytes = new Uint8Array(await blob.arrayBuffer());
                        resolve({
                            url: URL.createObjectURL(blob),
                            bytes,
                        });
                    } catch (error) {
                        reject(error);
                    }
                },
                MESSAGE_PREVIEW_MIME,
                MESSAGE_PREVIEW_COMPRESS
            );
        };

        timeout = setTimeout(() => fail(new Error('video poster timed out')), 12000);
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.onloadeddata = () => {
            if (targetTime <= 0) {
                requestAnimationFrame(finish);
            }
        };
        video.onseeked = () => requestAnimationFrame(finish);
        video.onerror = () => fail(video.error || new Error('video poster unavailable'));
        video.onloadedmetadata = () => {
            targetTime = getVideoPreviewTime(video.duration);
            if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.001) {
                try {
                    video.currentTime = Math.min(targetTime, Math.max(video.duration - 0.05, 0));
                } catch {
                    requestAnimationFrame(finish);
                }
                return;
            }
            if (video.readyState >= 2) {
                requestAnimationFrame(finish);
            }
        };
        video.src = src;
    });
}

function setReadyPosterBytes(key, bytes, options = {}) {
    const url = URL.createObjectURL(new Blob([bytes], { type: MESSAGE_PREVIEW_MIME }));
    return setReadyPoster(key, url, options);
}

export function loadVideoPoster(key, src, msg, readMessagePreview, writeMessagePreview, options = {}) {
    if (!key || typeof document === 'undefined') {
        return Promise.reject(new Error('video poster unavailable'));
    }

    const cached = getReadyPoster(key);
    if (cached) {
        return Promise.resolve(cached);
    }

    const current = videoPosterCache.get(key);
    if (current?.status === 'pending') {
        if (!src || current.src) {
            return current.promise;
        }
    }

    const epoch = videoPosterCache.epoch;
    const task = waitForIdle({ timeout: 400, delay: 120 })
        .then(async () => {
            const cachedBytes = typeof readMessagePreview === 'function' ? await readMessagePreview(msg) : null;
            if (cachedBytes?.byteLength) {
                if (epoch !== videoPosterCache.epoch) {
                    return '';
                }
                return setReadyPosterBytes(key, cachedBytes, options);
            }
            if (!src) {
                throw new Error('video poster pending');
            }
            const poster = await drawVideoPoster(src);
            if (epoch !== videoPosterCache.epoch) {
                revokeObjectUrl(poster?.url);
                return '';
            }
            if (poster?.bytes?.byteLength && typeof writeMessagePreview === 'function') {
                void writeMessagePreview(msg, poster.bytes, { mimeType: MESSAGE_PREVIEW_MIME }).catch(() => {});
            }
            return setReadyPoster(key, poster.url, options);
        })
        .catch((error) => {
            if (videoPosterCache.get(key)?.promise === task) {
                videoPosterCache.delete(key);
            }
            throw error;
        });

    videoPosterCache.setPending(key, task, { src: src || '' });
    return task;
}

export async function preloadMsgVideo(peerChatPK, msg, readMessageFile, options = {}) {
    const objectUrl = await loadVideoObjectUrl(peerChatPK, msg, readMessageFile, options);
    if (!objectUrl) {
        return '';
    }

    const posterKey = getMessagePreviewCacheKey(peerChatPK, msg) || getVideoCacheKey(peerChatPK, msg);
    await loadVideoPoster(posterKey, objectUrl, msg, options.readMessagePreview, options.writeMessagePreview, options).catch(() => '');
    return objectUrl;
}
