'use client';

import { AES_IV_BYTES, openAes, sealAes } from './crypto/aes.js';
import { makeMessagePreviewMedia } from './chat/previews.js';
import { cleanBytes, decoder, encoder, toBytes, toHex } from './crypto/core.js';

export const LOCAL_DATA_CACHE_VERSION = 2;
export const LOCAL_DATA_CACHE_LABEL = 'local-cache-v2';

const WRITE_DELAY_MS = 350;
const MEDIA_CACHE_MAX_BYTES = 128 * 1024 * 1024;
const MEDIA_CACHE_MAX_ITEMS = 96;
const MEDIA_ACCESS_TOUCH_MIN_MS = 60 * 1000;
const MEDIA_ENVELOPE_VERSION = 1;

function nowId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function emptyPayload() {
    return {
        version: LOCAL_DATA_CACHE_VERSION,
        savedAt: 0,
        chatsById: {},
        transfersById: {},
        transferIds: [],
        profilesByUid: {},
        mediaByKey: {},
    };
}

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function bytesFromHex(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
        throw new Error('invalid cache hex');
    }

    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function makeTs(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }

    return {
        toMillis() {
            return value;
        },
        toDate() {
            return new Date(value);
        },
    };
}

function timestampMs(value) {
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    const ms = Number(value);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function jsonClean(value) {
    if (value == null) {
        return value;
    }
    if (typeof value === 'bigint') {
        return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
    }
    if (typeof value !== 'object') {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map(jsonClean).filter((item) => item !== undefined);
    }

    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'function' || item === undefined) {
            continue;
        }
        const clean = jsonClean(item);
        if (clean !== undefined) {
            out[key] = clean;
        }
    }
    return out;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function normalizePayload(value) {
    const input = isObject(value) ? value : {};
    return {
        ...emptyPayload(),
        version: LOCAL_DATA_CACHE_VERSION,
        savedAt: Number.isFinite(input.savedAt) ? input.savedAt : 0,
        chatsById: isObject(input.chatsById) ? input.chatsById : {},
        transfersById: isObject(input.transfersById) ? input.transfersById : {},
        transferIds: Array.isArray(input.transferIds) ? input.transferIds.filter(Boolean) : [],
        profilesByUid: isObject(input.profilesByUid) ? input.profilesByUid : {},
        mediaByKey: isObject(input.mediaByKey) ? input.mediaByKey : {},
    };
}

function cacheAad(uid, network) {
    return encoder.encode(JSON.stringify(['veyl-local-cache', LOCAL_DATA_CACHE_VERSION, String(uid || ''), String(network || '')]));
}

async function sealPayload(key, payload, uid, network) {
    const body = encoder.encode(JSON.stringify({ ...normalizePayload(payload), savedAt: Date.now() }));
    const { iv, ct } = await sealAes(key, body, cacheAad(uid, network));
    return JSON.stringify({
        v: LOCAL_DATA_CACHE_VERSION,
        iv: toHex(iv),
        ct: toHex(ct),
    });
}

async function openPayload(key, raw, uid, network) {
    if (!raw) {
        return emptyPayload();
    }

    const envelope = JSON.parse(raw);
    if (envelope?.v !== LOCAL_DATA_CACHE_VERSION || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
        throw new Error('unsupported local cache');
    }

    const plain = await openAes(key, bytesFromHex(envelope.iv), bytesFromHex(envelope.ct), cacheAad(uid, network));
    return normalizePayload(JSON.parse(decoder.decode(plain)));
}

function mediaAad(uid, network, id) {
    return encoder.encode(JSON.stringify(['veyl-local-cache-media', LOCAL_DATA_CACHE_VERSION, String(uid || ''), String(network || ''), String(id || '')]));
}

function packMedia(iv, ct) {
    const out = new Uint8Array(1 + AES_IV_BYTES + ct.byteLength);
    out[0] = MEDIA_ENVELOPE_VERSION;
    out.set(iv, 1);
    out.set(ct, 1 + AES_IV_BYTES);
    return out;
}

function unpackMedia(raw) {
    const bytes = toBytes(raw, 'cached media');
    if (bytes.byteLength <= 1 + AES_IV_BYTES || bytes[0] !== MEDIA_ENVELOPE_VERSION) {
        throw new Error('unsupported cached media');
    }
    return {
        iv: bytes.slice(1, 1 + AES_IV_BYTES),
        ct: bytes.slice(1 + AES_IV_BYTES),
    };
}

async function sealMedia(key, bytes, uid, network, id) {
    const media = toBytes(bytes, 'media bytes');
    const { iv, ct } = await sealAes(key, media, mediaAad(uid, network, id));
    return packMedia(iv, ct);
}

async function openMedia(key, raw, uid, network, id) {
    const { iv, ct } = unpackMedia(raw);
    return openAes(key, iv, ct, mediaAad(uid, network, id));
}

function mediaCacheKey(msg) {
    const path = typeof msg?.p === 'string' ? msg.p.trim() : '';
    const fileKey = typeof msg?.k === 'string' ? msg.k.trim() : '';
    if (!path || !fileKey || path.startsWith('local:') || fileKey === 'local') {
        return null;
    }
    return `${path}\n${fileKey}`;
}

function mediaType(msg, meta = {}) {
    return String(meta?.mimeType || msg?.m || '').trim();
}

function pruneMedia(mediaByKey, keepKey = null) {
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
        if (count <= MEDIA_CACHE_MAX_ITEMS && total <= MEDIA_CACHE_MAX_BYTES) {
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

function collectMediaIds(payload, messages) {
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
        }, WRITE_DELAY_MS);
    };

    const patchPayload = (mutator, { flush = false } = {}) => {
        if (closed || typeof mutator !== 'function') {
            return Promise.resolve();
        }
        removed = false;
        const draft = clone(payload);
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
        const unique = [...new Set((ids || []).filter(Boolean))];
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

    const mediaCrypto = (id, keyBytes) => ({
        key: keyBytes,
        aad: mediaAad(uid, network, id),
        version: MEDIA_ENVELOPE_VERSION,
        ivBytes: AES_IV_BYTES,
    });

    return {
        id: nowId(),
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
                            ? await storage.openMedia(id, raw, mediaCrypto(id, readKey))
                            : await openMedia(readKey, raw, uid, network, id);
                    if (closed || epoch !== clearEpoch) {
                        return null;
                    }
                    const now = Date.now();
                    if (now - (Number(entry?.savedAt) || 0) >= MEDIA_ACCESS_TOUCH_MIN_MS) {
                        void patchPayload((draft) => {
                            if (draft.mediaByKey?.[key]?.id === id) {
                                draft.mediaByKey[key].savedAt = now;
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
            const id = typeof previous?.id === 'string' && previous.id ? previous.id : nowId();
            const writeKey = new Uint8Array(cacheKey);
            let raw;
            try {
                raw =
                    typeof storage.sealMedia === 'function'
                        ? await storage.sealMedia(id, mediaBytes, mediaCrypto(id, writeKey))
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

function serializeMsg(msg) {
    if (!isObject(msg)) {
        return null;
    }

    const { pending, failed, localUri, localData, type, ...rest } = msg;
    const clean = jsonClean(rest);
    const ts = timestampMs(msg.ts);
    if (ts != null) {
        clean.ts = ts;
    } else {
        delete clean.ts;
    }
    const ttl = timestampMs(msg.ttl);
    if (ttl != null) {
        clean.ttl = ttl;
    } else if (msg.ttl == null && 'ttl' in msg) {
        clean.ttl = null;
    } else {
        delete clean.ttl;
    }
    return clean;
}

function reviveMsg(msg) {
    if (!isObject(msg)) {
        return null;
    }

    const next = {
        ...msg,
        ts: makeTs(msg.ts),
    };
    if ('ttl' in msg) {
        next.ttl = msg.ttl == null ? null : makeTs(msg.ttl);
    }
    return next;
}

function serializeChat(chat) {
    if (!chat?.id) {
        return null;
    }

    return {
        id: chat.id,
        participants: Array.isArray(chat.participants) ? chat.participants.filter(Boolean) : [],
        settings: isObject(chat.settings) ? jsonClean(chat.settings) : undefined,
        lastMsg: serializeMsg(chat.lastMsg),
        ts: timestampMs(chat.ts) || 0,
        unseen: !!chat.unseen,
    };
}

function reviveChat(chat) {
    if (!chat?.id) {
        return null;
    }

    const lastMsg = reviveMsg(chat.lastMsg);
    return {
        id: chat.id,
        participants: Array.isArray(chat.participants) ? chat.participants.filter(Boolean) : [],
        settings: isObject(chat.settings) ? chat.settings : undefined,
        lastMsg,
        ts: timestampMs(chat.ts) || 0,
        unseen: !!chat.unseen,
    };
}

export function readCachedChats(cache) {
    const payload = cache?.read?.();
    if (!payload?.chatsById) {
        return [];
    }
    return Object.values(payload.chatsById)
        .map(reviveChat)
        .filter(Boolean)
        .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export function writeCachedChats(cache, chats) {
    if (!cache?.patch || !Array.isArray(chats)) {
        return;
    }

    void cache.patch((payload) => {
        const next = {};
        for (const chat of chats) {
            const item = serializeChat(chat);
            if (item?.id && item.lastMsg) {
                next[item.id] = item;
            }
        }
        payload.chatsById = next;
        return payload;
    });
}

export function dropCachedChat(cache, chatId) {
    if (!cache?.patch || !chatId) {
        return;
    }

    const mediaIds = [];
    void cache.patch((payload) => {
        if (payload.chatsById?.[chatId]?.lastMsg) {
            mediaIds.push(...collectMediaIds(payload, [payload.chatsById[chatId].lastMsg]));
        }
        delete payload.chatsById?.[chatId];
        return payload;
    }).then(() => cache.removeMediaIds?.(mediaIds));
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

function txCreatedMs(tx) {
    const value = tx?.createdTime;
    if (value instanceof Date) {
        return value.getTime();
    }
    const ms = new Date(value ?? 0).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

export function readCachedTransfers(cache) {
    const payload = cache?.read?.();
    if (!payload?.transfersById) {
        return [];
    }
    const ids = Array.isArray(payload.transferIds) && payload.transferIds.length ? payload.transferIds : Object.keys(payload.transfersById);
    return ids
        .map((id) => payload.transfersById[id])
        .filter(Boolean)
        .sort((a, b) => txCreatedMs(b) - txCreatedMs(a));
}

export function writeCachedTransfers(cache, transfers) {
    if (!cache?.patch || !Array.isArray(transfers)) {
        return;
    }

    void cache.patch((payload) => {
        const byId = {};
        const ids = [];
        const sorted = [...transfers].filter((tx) => tx?.id).sort((a, b) => txCreatedMs(b) - txCreatedMs(a));
        for (const tx of sorted) {
            const id = String(tx.id);
            byId[id] = jsonClean(tx);
            ids.push(id);
        }
        payload.transfersById = byId;
        payload.transferIds = ids;
        return payload;
    });
}

export function readCachedProfiles(cache) {
    const profiles = cache?.read?.()?.profilesByUid;
    return isObject(profiles) ? Object.values(profiles).filter((profile) => profile?.uid) : [];
}

export function writeCachedProfiles(cache, profiles) {
    if (!cache?.patch || !Array.isArray(profiles)) {
        return;
    }

    void cache.patch((payload) => {
        for (const profile of profiles) {
            if (!profile?.uid || (!profile.walletPK && !profile.chatPK)) {
                continue;
            }
            const previous = payload.profilesByUid[profile.uid] || {};
            payload.profilesByUid[profile.uid] = jsonClean({
                ...previous,
                ...profile,
                savedAt: Date.now(),
            });
        }
        return payload;
    });
}
