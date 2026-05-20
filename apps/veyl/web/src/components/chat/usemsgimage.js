'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@/components/providers/chatprovider';
import { isExpiredAttachmentMsg } from '@glyphteck/shared/chat/messages';

const imageCache = new Map();
const MAX_IMAGE_CACHE = 40;

function getCacheKey(msg) {
    return `${msg?.p || ''}:${msg?.k || ''}`;
}

function hasRemoteImageKey(msg) {
    const path = typeof msg?.p === 'string' ? msg.p.trim() : '';
    const fileKey = typeof msg?.k === 'string' ? msg.k.trim() : '';
    return msg?.t === 'img' && !!path && !!fileKey && !path.startsWith('local:') && fileKey !== 'local';
}

function isPromise(value) {
    return !!value && typeof value.then === 'function';
}

function isBlobUrl(value) {
    return typeof value === 'string' && value.startsWith('blob:');
}

function revokeUrl(value) {
    if (!isBlobUrl(value)) {
        return;
    }

    try {
        URL.revokeObjectURL(value);
    } catch {}
}

function trimImageCache() {
    if (imageCache.size <= MAX_IMAGE_CACHE) {
        return;
    }

    while (imageCache.size > MAX_IMAGE_CACHE) {
        let dropKey = null;
        let dropEntry = null;
        let dropPriority = Infinity;

        for (const [key, entry] of imageCache.entries()) {
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

        imageCache.delete(dropKey);
        revokeUrl(dropEntry?.url);
    }
}

function getReadyEntry(key) {
    const entry = imageCache.get(key);
    return entry?.status === 'ready' ? entry : null;
}

function retainImage(key) {
    const entry = getReadyEntry(key);
    if (!entry) {
        return null;
    }

    const next = {
        ...entry,
        refs: entry.refs + 1,
    };
    imageCache.set(key, next);
    return next.url;
}

function releaseImage(key) {
    const entry = getReadyEntry(key);
    if (!entry) {
        return;
    }

    imageCache.set(key, {
        ...entry,
        refs: Math.max(0, entry.refs - 1),
    });
}

function setPendingEntry(key, promise) {
    imageCache.set(key, {
        status: 'pending',
        promise,
    });
}

function setReadyEntry(key, url, options = {}) {
    const previous = getReadyEntry(key);
    if (previous?.url && previous.url !== url) {
        revokeUrl(previous.url);
    }

    imageCache.set(key, {
        status: 'ready',
        url,
        refs: previous?.refs ?? 0,
        priority: Math.max(Number(previous?.priority) || 0, Number(options.priority) || 0),
    });
    trimImageCache();
    return url;
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
    if (!hasRemoteImageKey(msg) || !peerChatPK || typeof readMessageFile !== 'function') {
        return Promise.resolve('');
    }

    const key = getCacheKey(msg);
    const expired = isExpiredAttachmentMsg(msg);
    const cached = expired ? null : getReadyEntry(key);
    if (cached?.url) {
        return Promise.resolve(cached.url);
    }

    const current = expired ? null : imageCache.get(key);
    if (current?.status === 'pending' && isPromise(current.promise)) {
        return current.promise;
    }

    const task = withTimeout(Promise.resolve(readMessageFile(peerChatPK, msg)), 12000)
        .then(async (bytes) => {
            if (!bytes?.byteLength) {
                throw new Error('image unavailable');
            }
            const nextSrc = URL.createObjectURL(new Blob([bytes], { type: msg?.m || 'image/jpeg' }));
            await warmImage(nextSrc);
            return setReadyEntry(key, nextSrc, options);
        })
        .catch((error) => {
            imageCache.delete(key);
            throw error;
        });

    setPendingEntry(key, task);
    return task;
}

export function seedMsgImage(msg, url, options = {}) {
    if (!hasRemoteImageKey(msg) || !url) {
        return '';
    }
    return setReadyEntry(getCacheKey(msg), url, options);
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
    const [loading, setLoading] = useState(() => msg?.t === 'img' && !msg?.localUri);
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

        if (!hasRemoteImageKey(msg) || !peerChatPK) {
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
        const task = cached?.status === 'pending' && isPromise(cached.promise) ? cached.promise : preloadMsgImage(peerChatPK, msg, readMessageFile);

        if (!(cached?.status === 'pending' && cached.promise === task)) {
            setPendingEntry(key, task);
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
