'use client';

import { openVaultCache } from '@veyl/shared/cache/localdata';
import { cleanBytes, fromHexBytes, randomBytes, toHex } from '@veyl/shared/crypto/core';
import { deriveDeviceCacheKey } from '@veyl/shared/crypto/seed';
import { resolveNetwork } from '@veyl/shared/network';
import { createIdbOpener, idbRequest, idbTx } from '@/lib/cache/idb';

const DB_NAME = 'veyl-vault-local-cache';
const DB_VERSION = 1;
const STORE_NAME = 'cache';
const INSTALL_SECRET_BYTES = 32;

const openDb = createIdbOpener(DB_NAME, DB_VERSION, [STORE_NAME]);

function valueSize(value) {
    if (typeof value === 'string') {
        return new Blob([value]).size;
    }
    if (value instanceof Uint8Array) {
        return value.byteLength;
    }
    if (value instanceof ArrayBuffer) {
        return value.byteLength;
    }
    if (ArrayBuffer.isView(value)) {
        return value.byteLength;
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        return value.size;
    }
    return 0;
}

function storageScope(uid, network) {
    return JSON.stringify([String(network || ''), String(uid || '')]);
}

function mainKey(scope) {
    return `main:${scope}`;
}

function mediaKeyPrefix(scope) {
    return `media:${scope}:`;
}

function installSecretKey(scope) {
    return `install:${scope}`;
}

function parseInstallSecret(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
        return null;
    }
    return fromHexBytes(value, 'local cache install secret');
}

async function readOrCreateInstallSecret(scope) {
    const key = installSecretKey(scope);
    const db = await openDb();
    if (!db) {
        return randomBytes(INSTALL_SECRET_BYTES);
    }

    const readTx = db.transaction(STORE_NAME, 'readonly');
    const existing = parseInstallSecret(await idbRequest(readTx.objectStore(STORE_NAME).get(key)).catch(() => null));
    if (existing) {
        return existing;
    }

    const secret = randomBytes(INSTALL_SECRET_BYTES);
    try {
        const writeTx = db.transaction(STORE_NAME, 'readwrite');
        writeTx.objectStore(STORE_NAME).put(toHex(secret), key);
        await idbTx(writeTx);
    } catch {}
    return secret;
}

async function localCacheKey(rootKey, { uid, network, scope }) {
    const installSecret = await readOrCreateInstallSecret(scope);
    try {
        return deriveDeviceCacheKey(rootKey, installSecret, uid, network);
    } finally {
        cleanBytes(installSecret);
    }
}

function makeStorage({ uid, network }) {
    const scope = storageScope(uid, network);
    const key = mainKey(scope);
    const mediaPrefix = mediaKeyPrefix(scope);

    return {
        async read() {
            const db = await openDb();
            if (!db) {
                return null;
            }

            const tx = db.transaction(STORE_NAME, 'readonly');
            return idbRequest(tx.objectStore(STORE_NAME).get(key));
        },
        async write(raw) {
            const db = await openDb();
            if (!db) {
                return;
            }

            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(raw, key);
            await idbTx(tx);
        },
        async remove() {
            const db = await openDb();
            if (!db) {
                return;
            }

            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(key);
            await idbTx(tx);
        },
        async readMedia(id) {
            const db = await openDb();
            if (!db || !id) {
                return null;
            }

            const tx = db.transaction(STORE_NAME, 'readonly');
            return idbRequest(tx.objectStore(STORE_NAME).get(`${mediaPrefix}${id}`));
        },
        async writeMedia(id, raw) {
            const db = await openDb();
            if (!db || !id) {
                return;
            }

            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(raw, `${mediaPrefix}${id}`);
            await idbTx(tx);
        },
        async removeMedia(id) {
            const db = await openDb();
            if (!db || !id) {
                return;
            }

            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(`${mediaPrefix}${id}`);
            await idbTx(tx);
        },
        async removeAllMedia() {
            const db = await openDb();
            if (!db) {
                return;
            }

            const readTx = db.transaction(STORE_NAME, 'readonly');
            const keys = await idbRequest(readTx.objectStore(STORE_NAME).getAllKeys());

            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (const key of keys || []) {
                if (typeof key === 'string' && key.startsWith(mediaPrefix)) {
                    store.delete(key);
                }
            }
            await idbTx(tx);
        },
        async estimateSize() {
            const db = await openDb();
            if (!db) {
                return 0;
            }

            const keyTx = db.transaction(STORE_NAME, 'readonly');
            const keys = await idbRequest(keyTx.objectStore(STORE_NAME).getAllKeys());
            const selected = (keys || []).filter((item) => item === key || (typeof item === 'string' && item.startsWith(mediaPrefix)));
            if (selected.length === 0) {
                return 0;
            }

            const valueTx = db.transaction(STORE_NAME, 'readonly');
            const store = valueTx.objectStore(STORE_NAME);
            const values = await Promise.all(selected.map((item) => idbRequest(store.get(item))));
            return values.reduce((total, value) => total + valueSize(value), 0);
        },
    };
}

export async function openLocalDataCache(key, { uid } = {}) {
    const network = resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK });
    const scope = storageScope(uid, network);
    const cacheKey = await localCacheKey(key, { uid, network, scope });
    try {
        return await openVaultCache({
            key: cacheKey,
            storage: makeStorage({ uid, network }),
            uid,
            network,
        });
    } finally {
        cleanBytes(cacheKey);
    }
}
