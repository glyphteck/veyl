'use client';

import { LOCAL_CACHE_WRITE_DELAY_MS, LOCAL_MEDIA_ACCESS_TOUCH_MIN_MS } from '../../config.js';
import { cleanBytes, encoder, toBytes } from '../../crypto/core.js';
import { uniqueValues } from '../../utils/array.js';
import { makeCacheId, mediaCrypto, openMedia, openPayload, sealMedia, sealPayload } from './crypto.js';
import { mediaCacheKey, mediaType, pruneMedia } from './media.js';
import { draftPayload, emptyPayload, normalizePayload } from './schema.js';

export async function openVaultCache({ key, storage, uid, network }) {
    if (!(key instanceof Uint8Array) || key.length !== 32) {
        throw new Error('local cache key required');
    }
    if (!storage || typeof storage.read !== 'function' || typeof storage.write !== 'function') {
        throw new Error('local cache storage required');
    }

    const cacheKey = new Uint8Array(key);
    let payload = emptyPayload();
    let closed = false;
    let removed = false;
    let clearEpoch = 0;
    let writeTimer = null;
    let writeTask = Promise.resolve();

    try {
        payload = await openPayload(cacheKey, await storage.read(), uid, network);
    } catch {
        payload = emptyPayload();
    }

    const writeNow = () => {
        if (closed) {
            return writeTask;
        }

        if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
        }

        writeTask = writeTask
            .catch(() => {})
            .then(async () => {
                if (closed) return;
                if (removed) {
                    if (typeof storage.remove === 'function') {
                        await storage.remove();
                    } else {
                        await storage.write('');
                    }
                    return;
                }
                const writeKey = new Uint8Array(cacheKey);
                try {
                    await storage.write(await sealPayload(writeKey, payload, uid, network));
                } finally {
                    cleanBytes(writeKey);
                }
            })
            .catch(() => {});
        return writeTask;
    };

    const scheduleWrite = () => {
        if (closed || writeTimer) {
            return;
        }
        writeTimer = setTimeout(() => {
            writeTimer = null;
            void writeNow();
        }, LOCAL_CACHE_WRITE_DELAY_MS);
    };

    const patchPayload = (mutator, { flush = false } = {}) => {
        if (closed || typeof mutator !== 'function') {
            return Promise.resolve();
        }
        removed = false;
        const draft = draftPayload(payload);
        payload = normalizePayload(mutator(draft) || draft);
        if (flush) {
            return writeNow();
        }
        scheduleWrite();
        return Promise.resolve();
    };

    const removeMediaIds = async (ids = []) => {
        if (typeof storage.removeMedia !== 'function') {
            return;
        }
        const unique = uniqueValues(ids);
        await Promise.all(unique.map((id) => storage.removeMedia(id).catch(() => {})));
    };

    const dropMediaKeys = async (keys = []) => {
        const ids = [];
        await patchPayload((draft) => {
            for (const key of keys || []) {
                const id = key ? draft.mediaByKey?.[key]?.id : null;
                if (id) {
                    ids.push(id);
                }
                if (key) {
                    delete draft.mediaByKey?.[key];
                }
            }
            return draft;
        });
        await removeMediaIds(ids);
    };

    const makeMediaCrypto = (id, keyBytes) => mediaCrypto(uid, network, id, keyBytes);

    return {
        id: makeCacheId(),
        read() {
            return payload;
        },
        patch: patchPayload,
        flush: writeNow,
        async readMedia(msg) {
            if (closed || typeof storage.readMedia !== 'function') {
                return null;
            }

            const epoch = clearEpoch;
            const key = mediaCacheKey(msg);
            const entry = key ? payload.mediaByKey?.[key] : null;
            const id = typeof entry?.id === 'string' ? entry.id : '';
            if (!key || !id) {
                return null;
            }

            try {
                const raw = await storage.readMedia(id);
                if (!raw) {
                    if (!closed && epoch === clearEpoch) {
                        await dropMediaKeys([key]);
                    }
                    return null;
                }
                if (closed || epoch !== clearEpoch) {
                    return null;
                }

                const readKey = new Uint8Array(cacheKey);
                try {
                    const bytes =
                        typeof storage.openMedia === 'function'
                            ? await storage.openMedia(id, raw, makeMediaCrypto(id, readKey))
                            : await openMedia(readKey, raw, uid, network, id);
                    if (closed || epoch !== clearEpoch) {
                        return null;
                    }
                    const now = Date.now();
                    if (now - (Number(entry?.savedAt) || 0) >= LOCAL_MEDIA_ACCESS_TOUCH_MIN_MS) {
                        void patchPayload((draft) => {
                            const current = draft.mediaByKey?.[key];
                            if (current?.id === id) {
                                draft.mediaByKey[key] = { ...current, savedAt: now };
                            }
                            return draft;
                        }).catch(() => {});
                    }
                    return bytes;
                } finally {
                    cleanBytes(readKey);
                }
            } catch {
                if (!closed && epoch === clearEpoch) {
                    await dropMediaKeys([key]);
                }
                return null;
            }
        },
        async writeMedia(msg, bytes, meta = {}) {
            if (closed || typeof storage.writeMedia !== 'function') {
                return false;
            }

            const epoch = clearEpoch;
            const key = mediaCacheKey(msg);
            if (!key) {
                return false;
            }

            const mediaBytes = toBytes(bytes, 'media bytes');
            const previous = payload.mediaByKey?.[key];
            const id = typeof previous?.id === 'string' && previous.id ? previous.id : makeCacheId();
            const writeKey = new Uint8Array(cacheKey);
            let raw;
            try {
                raw =
                    typeof storage.sealMedia === 'function'
                        ? await storage.sealMedia(id, mediaBytes, makeMediaCrypto(id, writeKey))
                        : await sealMedia(writeKey, mediaBytes, uid, network, id);
            } finally {
                cleanBytes(writeKey);
            }

            if (closed || removed || epoch !== clearEpoch) {
                return false;
            }

            await storage.writeMedia(id, raw);
            if (closed || removed || epoch !== clearEpoch) {
                await removeMediaIds([id]);
                return false;
            }

            const removedIds = [];
            await patchPayload((draft) => {
                draft.mediaByKey[key] = {
                    id,
                    size: Number(mediaBytes.byteLength) || 0,
                    type: mediaType(msg, meta),
                    savedAt: Date.now(),
                };
                removedIds.push(...pruneMedia(draft.mediaByKey, key));
                return draft;
            });
            await removeMediaIds(removedIds.filter((removedId) => removedId !== id));
            return true;
        },
        async dropMedia(msg) {
            const key = mediaCacheKey(msg);
            if (key) {
                await dropMediaKeys([key]);
            }
        },
        removeMediaIds,
        estimateSize() {
            if (typeof storage.estimateSize === 'function') {
                return storage.estimateSize().catch(() => 0);
            }

            const mainSize = encoder.encode(JSON.stringify(normalizePayload(payload))).byteLength;
            const mediaSize = Object.values(payload.mediaByKey || {}).reduce((total, entry) => total + (Number(entry?.size) || 0), 0);
            return Promise.resolve(mainSize + mediaSize);
        },
        async clear() {
            clearEpoch += 1;
            payload = emptyPayload();
            removed = true;
            if (writeTimer) {
                clearTimeout(writeTimer);
                writeTimer = null;
            }
            if (typeof storage.remove === 'function') {
                await storage.remove();
            } else {
                await storage.write('');
            }
            if (typeof storage.removeAllMedia === 'function') {
                await storage.removeAllMedia();
            }
        },
        close({ flush = true } = {}) {
            if (closed) {
                return writeTask;
            }
            if (writeTimer) {
                clearTimeout(writeTimer);
                writeTimer = null;
            }
            const finish = () => {
                clearEpoch += 1;
                closed = true;
                payload = emptyPayload();
                cleanBytes(cacheKey);
            };
            if (!flush) {
                finish();
                return writeTask;
            }
            writeTask = writeNow().finally(finish);
            return writeTask;
        },
    };
}
