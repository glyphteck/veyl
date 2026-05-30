'use client';

import { createObjectUrlCache, revokeObjectUrl } from './objecturlcache';

const audioCache = createObjectUrlCache({ max: 16 });

export function getAudioCacheKey(peerChatPK, msg) {
    return `${peerChatPK}:${msg?.p || ''}:${msg?.k || ''}`;
}

export function retainAudio(key) {
    return audioCache.retain(key);
}

export function releaseAudio(key) {
    audioCache.release(key);
}

export function loadAudioObjectUrl(peerChatPK, msg, readMessageFile) {
    if (msg?.t !== 'mp3' || !peerChatPK || !msg?.p || !msg?.k || typeof readMessageFile !== 'function') {
        return Promise.resolve('');
    }

    const key = getAudioCacheKey(peerChatPK, msg);
    const pending = audioCache.getPendingPromise(key);
    if (pending) {
        return pending;
    }

    const epoch = audioCache.epoch;
    const task = Promise.resolve(readMessageFile(peerChatPK, msg))
        .then((bytes) => {
            if (!bytes?.byteLength) {
                throw new Error('audio unavailable');
            }
            const objectUrl = URL.createObjectURL(new Blob([bytes], { type: msg?.m || 'audio/mpeg' }));
            if (epoch !== audioCache.epoch) {
                revokeObjectUrl(objectUrl);
                return '';
            }
            return audioCache.setReady(key, objectUrl);
        })
        .catch((nextError) => {
            audioCache.delete(key);
            throw nextError;
        });

    audioCache.setPending(key, task);
    return task;
}

export function clearAudioCache() {
    audioCache.clear();
}
