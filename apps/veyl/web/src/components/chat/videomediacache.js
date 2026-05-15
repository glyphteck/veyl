'use client';

import { getMessagePreviewCacheKey, MESSAGE_PREVIEW_COMPRESS, MESSAGE_PREVIEW_MAX_EDGE, MESSAGE_PREVIEW_MIME } from '@glyphteck/shared/chat/previews';

const videoCache = new Map();
const videoPosterCache = new Map();
const MAX_VIDEO_CACHE = 16;
const MAX_VIDEO_POSTER_CACHE = 40;

export function getVideoCacheKey(peerChatPK, msg) {
    if (msg?.p && msg?.k) {
        return `${msg.p}:${msg.k}`;
    }
    return `${peerChatPK}:${msg?.p || msg?.localUri || ''}:${msg?.k || msg?.id || msg?.cid || ''}`;
}

function isPromise(value) {
    return !!value && typeof value.then === 'function';
}

function revokeUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('blob:')) {
        return;
    }

    try {
        URL.revokeObjectURL(value);
    } catch {}
}

function trimVideoCache() {
    if (videoCache.size <= MAX_VIDEO_CACHE) {
        return;
    }

    while (videoCache.size > MAX_VIDEO_CACHE) {
        let dropKey = null;
        let dropEntry = null;
        let dropPriority = Infinity;

        for (const [key, entry] of videoCache.entries()) {
            if (!entry || entry.status !== 'ready' || entry.refs > 0) {
                continue;
            }
            const priority = Number(entry.priority) || 0;
            if (priority < dropPriority) {
                dropKey = key;
                dropEntry = entry;
                dropPriority = priority;
            }
        }

        if (!dropKey) {
            return;
        }

        videoCache.delete(dropKey);
        revokeUrl(dropEntry?.url);
    }
}

function getReadyEntry(key) {
    const entry = videoCache.get(key);
    return entry?.status === 'ready' ? entry : null;
}

export function retainVideo(key) {
    const entry = getReadyEntry(key);
    if (!entry) {
        return null;
    }

    videoCache.set(key, {
        ...entry,
        refs: entry.refs + 1,
    });
    return entry.url;
}

export function releaseVideo(key) {
    const entry = getReadyEntry(key);
    if (!entry) {
        return;
    }

    videoCache.set(key, {
        ...entry,
        refs: Math.max(0, entry.refs - 1),
    });
}

function setPendingEntry(key, promise) {
    videoCache.set(key, {
        status: 'pending',
        promise,
    });
}

function setReadyEntry(key, url, options = {}) {
    const previous = getReadyEntry(key);
    if (previous?.url && previous.url !== url) {
        revokeUrl(previous.url);
    }

    videoCache.set(key, {
        status: 'ready',
        url,
        refs: previous?.refs ?? 0,
        priority: Math.max(Number(previous?.priority) || 0, Number(options.priority) || 0),
    });
    trimVideoCache();
    return url;
}

export function loadVideoObjectUrl(peerChatPK, msg, readMessageFile, options = {}) {
    if (msg?.t !== 'mp4' || !peerChatPK || !msg?.p || !msg?.k || typeof readMessageFile !== 'function') {
        return Promise.resolve('');
    }

    const key = getVideoCacheKey(peerChatPK, msg);
    const cached = getReadyEntry(key);
    if (cached?.url) {
        return Promise.resolve(cached.url);
    }

    const current = videoCache.get(key);
    if (current?.status === 'pending' && isPromise(current.promise)) {
        return current.promise;
    }

    const task = Promise.resolve(readMessageFile(peerChatPK, msg))
        .then((bytes) => {
            if (!bytes?.byteLength) {
                throw new Error('video unavailable');
            }
            const objectUrl = URL.createObjectURL(new Blob([bytes], { type: msg?.m || 'video/mp4' }));
            return setReadyEntry(key, objectUrl, options);
        })
        .catch((error) => {
            videoCache.delete(key);
            throw error;
        });

    setPendingEntry(key, task);
    return task;
}

export function getReadyPoster(key) {
    const entry = videoPosterCache.get(key);
    if (entry?.status !== 'ready' || !entry.url) {
        return '';
    }
    videoPosterCache.delete(key);
    videoPosterCache.set(key, entry);
    return entry.url;
}

function trimVideoPosterCache() {
    while (videoPosterCache.size > MAX_VIDEO_POSTER_CACHE) {
        let dropKey = null;
        let dropEntry = null;
        let dropPriority = Infinity;

        for (const [key, entry] of videoPosterCache.entries()) {
            if (entry?.status !== 'ready') {
                continue;
            }
            const priority = Number(entry.priority) || 0;
            if (priority < dropPriority) {
                dropKey = key;
                dropEntry = entry;
                dropPriority = priority;
            }
        }

        if (!dropKey) {
            return;
        }

        videoPosterCache.delete(dropKey);
        revokeUrl(dropEntry?.url);
    }
}

function setReadyPoster(key, url, options = {}) {
    const previous = videoPosterCache.get(key);
    if (previous?.status === 'ready' && previous.url !== url) {
        revokeUrl(previous.url);
    }
    videoPosterCache.delete(key);
    videoPosterCache.set(key, {
        status: 'ready',
        url,
        priority: Math.max(Number(previous?.priority) || 0, Number(options.priority) || 0),
    });
    trimVideoPosterCache();
    return url;
}

function waitForIdle() {
    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => resolve(), { timeout: 400 });
            return;
        }
        setTimeout(resolve, 120);
    });
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

    const task = waitForIdle()
        .then(async () => {
            const cachedBytes = typeof readMessagePreview === 'function' ? await readMessagePreview(msg) : null;
            if (cachedBytes?.byteLength) {
                return setReadyPosterBytes(key, cachedBytes, options);
            }
            if (!src) {
                throw new Error('video poster pending');
            }
            const poster = await drawVideoPoster(src);
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

    videoPosterCache.set(key, { status: 'pending', promise: task, src: src || '' });
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
