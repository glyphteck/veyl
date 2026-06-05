'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@/components/providers/chatprovider';
import { hasStoredFileRef, isExpiredAttachmentMsg } from '@veyl/shared/chat/messages';
import { createObjectUrlCache, revokeObjectUrl } from './objecturlcache';

const imageCache = createObjectUrlCache({ max: 40 });

function getCacheKey(msg) {
    return `${msg?.p || ''}:${msg?.k || ''}`;
}

function isRemoteImageMsg(msg) {
    return msg?.t === 'img' && hasStoredFileRef(msg);
}

function retainImage(key) {
    return imageCache.retain(key);
}

function releaseImage(key) {
    imageCache.release(key);
}

export function clearMsgImageCache() {
    imageCache.clear();
}

function warmImage(url) {
    if (typeof Image === 'undefined' || !url) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = url;
        if (typeof image.decode === 'function') {
            image.decode().then(resolve).catch(resolve);
        }
    });
}

export function preloadMsgImage(peerChatPK, msg, readMessageFile, options = {}) {
    if (!isRemoteImageMsg(msg) || !peerChatPK || typeof readMessageFile !== 'function') {
        return Promise.resolve('');
    }

    const key = getCacheKey(msg);
    const expired = isExpiredAttachmentMsg(msg);
    const cached = expired ? null : imageCache.getReady(key);
    if (cached?.url) {
        return Promise.resolve(cached.url);
    }

    const pending = expired ? null : imageCache.getPendingPromise(key);
    if (pending) {
        return pending;
    }

    const epoch = imageCache.epoch;
    const task = withTimeout(Promise.resolve(readMessageFile(peerChatPK, msg)), 12000)
        .then(async (bytes) => {
            if (!bytes?.byteLength) {
                throw new Error('image unavailable');
            }
            const nextSrc = URL.createObjectURL(new Blob([bytes], { type: msg?.m || 'image/jpeg' }));
            await warmImage(nextSrc);
            if (epoch !== imageCache.epoch) {
                revokeObjectUrl(nextSrc);
                return '';
            }
            return imageCache.setReady(key, nextSrc, options);
        })
        .catch((error) => {
            imageCache.delete(key);
            throw error;
        });

    imageCache.setPending(key, task);
    return task;
}

export function readCachedMsgImageUrl(msg) {
    if (!isRemoteImageMsg(msg) || isExpiredAttachmentMsg(msg)) {
        return '';
    }
    return imageCache.getReady(getCacheKey(msg))?.url || '';
}

export function seedMsgImage(msg, url, options = {}) {
    if (!isRemoteImageMsg(msg) || !url) {
        return '';
    }
    return imageCache.setReady(getCacheKey(msg), url, options);
}

function withTimeout(promise, ms) {
    let timerId;
    return Promise.race([
        promise.finally(() => {
            if (timerId) {
                clearTimeout(timerId);
            }
        }),
        new Promise((_, reject) => {
            timerId = setTimeout(() => {
                const error = new Error(`image load timed out after ${ms}ms`);
                error.stage = 'client-timeout';
                error.code = 'timeout';
                reject(error);
            }, ms);
        }),
    ]);
}

export function useMsgImage(peerChatPK, msg) {
    const { readMessageFile } = useChat();
    const [src, setSrc] = useState(() => (!isExpiredAttachmentMsg(msg) && typeof msg?.localUri === 'string' && msg.localUri ? msg.localUri : null));
    const [loading, setLoading] = useState(() => isRemoteImageMsg(msg) && !msg?.localUri);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        let retainedKey = null;
        const expired = isExpiredAttachmentMsg(msg);
        const localUri = !expired && typeof msg?.localUri === 'string' && msg.localUri ? msg.localUri : null;
        if (localUri) {
            setSrc(localUri);
            setLoading(false);
            setError(null);
            return;
        }

        if (!isRemoteImageMsg(msg) || !peerChatPK) {
            setSrc(null);
            setLoading(false);
            setError(null);
            return;
        }

        const key = getCacheKey(msg);
        const cached = expired ? null : imageCache.get(key);
        const cachedUrl = expired ? null : retainImage(key);
        if (cachedUrl) {
            retainedKey = key;
            setSrc(cachedUrl);
            setLoading(false);
            setError(null);
            return () => {
                releaseImage(retainedKey);
            };
        }

        setLoading(true);
        setError(null);
        const pending = cached?.status === 'pending' ? imageCache.getPendingPromise(key) : null;
        const task = pending || preloadMsgImage(peerChatPK, msg, readMessageFile);

        if (!pending) {
            imageCache.setPending(key, task);
        }

        task.then((nextSrc) => {
            if (cancelled) {
                return;
            }
            retainImage(key);
            retainedKey = key;
            setSrc(nextSrc);
            setLoading(false);
            setError(null);
        }).catch((error) => {
            if (cancelled) {
                return;
            }
            const nextError = {
                stage: error?.stage || null,
                path: msg?.p || error?.path || null,
                code: error?.code || null,
                status: error?.status || null,
                message: error?.message || String(error),
                details: error?.details || null,
            };
            console.warn('chat image load failed', nextError);
            setError(nextError);
            setLoading(false);
        });

        return () => {
            cancelled = true;
            if (retainedKey) {
                releaseImage(retainedKey);
            }
        };
    }, [msg?.k, msg?.localUri, msg?.m, msg?.p, msg?.t, peerChatPK, readMessageFile]);

    return { src, loading, error };
}
