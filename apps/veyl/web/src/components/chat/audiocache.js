'use client';

const audioCache = new Map();
const MAX_AUDIO_CACHE = 16;
let audioCacheEpoch = 0;

export function getAudioCacheKey(peerChatPK, msg) {
    return `${peerChatPK}:${msg?.p || ''}:${msg?.k || ''}`;
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

function trimAudioCache() {
    if (audioCache.size <= MAX_AUDIO_CACHE) {
        return;
    }

    for (const [key, entry] of audioCache.entries()) {
        if (audioCache.size <= MAX_AUDIO_CACHE) {
            break;
        }
        if (!entry || entry.status !== 'ready' || entry.refs > 0) {
            continue;
        }

        audioCache.delete(key);
        revokeUrl(entry.url);
    }
}

function getReadyEntry(key) {
    const entry = audioCache.get(key);
    return entry?.status === 'ready' ? entry : null;
}

export function retainAudio(key) {
    const entry = getReadyEntry(key);
    if (!entry) {
        return null;
    }

    audioCache.set(key, {
        ...entry,
        refs: entry.refs + 1,
    });
    return entry.url;
}

export function releaseAudio(key) {
    const entry = getReadyEntry(key);
    if (!entry) {
        return;
    }

    audioCache.set(key, {
        ...entry,
        refs: Math.max(0, entry.refs - 1),
    });
}

function setPendingEntry(key, promise) {
    audioCache.set(key, {
        status: 'pending',
        promise,
    });
}

function setReadyEntry(key, url) {
    const previous = getReadyEntry(key);
    if (previous?.url && previous.url !== url) {
        revokeUrl(previous.url);
    }

    audioCache.set(key, {
        status: 'ready',
        url,
        refs: previous?.refs ?? 0,
    });
    trimAudioCache();
    return url;
}

export function loadAudioObjectUrl(peerChatPK, msg, readMessageFile) {
    if (msg?.t !== 'mp3' || !peerChatPK || !msg?.p || !msg?.k || typeof readMessageFile !== 'function') {
        return Promise.resolve('');
    }

    const key = getAudioCacheKey(peerChatPK, msg);
    const current = audioCache.get(key);
    if (current?.status === 'pending' && isPromise(current.promise)) {
        return current.promise;
    }

    const epoch = audioCacheEpoch;
    const task = Promise.resolve(readMessageFile(peerChatPK, msg))
        .then((bytes) => {
            if (!bytes?.byteLength) {
                throw new Error('audio unavailable');
            }
            const objectUrl = URL.createObjectURL(new Blob([bytes], { type: msg?.m || 'audio/mpeg' }));
            if (epoch !== audioCacheEpoch) {
                revokeUrl(objectUrl);
                return '';
            }
            return setReadyEntry(key, objectUrl);
        })
        .catch((nextError) => {
            audioCache.delete(key);
            throw nextError;
        });

    setPendingEntry(key, task);
    return task;
}

export function clearAudioCache() {
    audioCacheEpoch += 1;
    for (const entry of audioCache.values()) {
        if (entry?.status === 'ready') {
            revokeUrl(entry.url);
        }
    }
    audioCache.clear();
}
