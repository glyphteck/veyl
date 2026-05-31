'use client';

import { makeMessagePreviewMedia } from '../../chat/previews.js';
import { LOCAL_MEDIA_CACHE_MAX_BYTES, LOCAL_MEDIA_CACHE_MAX_ITEMS } from '../../config.js';
import { cleanText } from '../../utils/text.js';
import { isObject } from './schema.js';

export function mediaCacheKey(msg) {
    const path = cleanText(msg?.p);
    const fileKey = cleanText(msg?.k);
    if (!path || !fileKey || path.startsWith('local:') || fileKey === 'local') {
        return null;
    }
    return `${path}\n${fileKey}`;
}

export function mediaType(msg, meta = {}) {
    return cleanText(meta?.mimeType || msg?.m);
}

export function pruneMedia(mediaByKey, keepKey = null) {
    if (!isObject(mediaByKey)) {
        return [];
    }

    const removed = [];
    let total = 0;
    const entries = [];

    for (const [key, entry] of Object.entries(mediaByKey)) {
        const id = typeof entry?.id === 'string' ? entry.id : '';
        const size = Number(entry?.size) || 0;
        if (!key || !id) {
            delete mediaByKey[key];
            continue;
        }

        total += Math.max(0, size);
        entries.push({
            key,
            id,
            size: Math.max(0, size),
            savedAt: Number(entry?.savedAt) || 0,
        });
    }

    entries.sort((a, b) => {
        const delta = a.savedAt - b.savedAt;
        if (delta !== 0) return delta;
        return a.key.localeCompare(b.key);
    });

    let count = entries.length;
    for (const entry of entries) {
        if (count <= LOCAL_MEDIA_CACHE_MAX_ITEMS && total <= LOCAL_MEDIA_CACHE_MAX_BYTES) {
            break;
        }
        if (entry.key === keepKey && count <= 1) {
            break;
        }
        if (entry.key === keepKey) {
            continue;
        }

        delete mediaByKey[entry.key];
        removed.push(entry.id);
        total -= entry.size;
        count -= 1;
    }

    return removed;
}

export function collectMediaIds(payload, messages) {
    const ids = [];
    const mediaByKey = payload?.mediaByKey;
    if (!isObject(mediaByKey)) {
        return ids;
    }

    for (const message of messages || []) {
        for (const item of [message, makeMessagePreviewMedia(message)]) {
            const key = mediaCacheKey(item);
            const id = key ? mediaByKey[key]?.id : null;
            if (id) {
                ids.push(id);
                delete mediaByKey[key];
            }
        }
    }

    return ids;
}

export function getCachedMediaKey(msg) {
    return mediaCacheKey(msg);
}

export function readCachedMedia(cache, msg) {
    if (typeof cache?.readMedia !== 'function') {
        return Promise.resolve(null);
    }
    return cache.readMedia(msg);
}

export function writeCachedMedia(cache, msg, bytes, meta = {}) {
    if (typeof cache?.writeMedia !== 'function') {
        return Promise.resolve(false);
    }
    return cache.writeMedia(msg, bytes, meta);
}

export function dropCachedMedia(cache, msg) {
    if (typeof cache?.dropMedia !== 'function') {
        return Promise.resolve();
    }
    return Promise.all([cache.dropMedia(msg), cache.dropMedia(makeMessagePreviewMedia(msg))]).then(() => undefined);
}
