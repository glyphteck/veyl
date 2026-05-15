'use client';

import { openVaultCache } from '@glyphteck/shared/localdatacache';
import { resolveNetwork } from '@glyphteck/shared/network';

const DB_NAME = 'veyl-vault-local-cache';
const DB_VERSION = 1;
const STORE_NAME = 'cache';
const CACHE_KEY = 'main';
const MEDIA_KEY_PREFIX = 'media:';

let dbPromise = null;

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function txToPromise(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
    });
}

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

function openDb() {
    if (typeof indexedDB === 'undefined') {
        return Promise.resolve(null);
    }
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }).catch((error) => {
        dbPromise = null;
        throw error;
    });

    return dbPromise;
}

const storage = {
    async read() {
        const db = await openDb();
        if (!db) {
            return null;
        }

        const tx = db.transaction(STORE_NAME, 'readonly');
        return requestToPromise(tx.objectStore(STORE_NAME).get(CACHE_KEY));
    },
    async write(raw) {
        const db = await openDb();
        if (!db) {
            return;
        }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(raw, CACHE_KEY);
        await txToPromise(tx);
    },
    async remove() {
        const db = await openDb();
        if (!db) {
            return;
        }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(CACHE_KEY);
        await txToPromise(tx);
    },
    async readMedia(id) {
        const db = await openDb();
        if (!db || !id) {
            return null;
        }

        const tx = db.transaction(STORE_NAME, 'readonly');
        return requestToPromise(tx.objectStore(STORE_NAME).get(`${MEDIA_KEY_PREFIX}${id}`));
    },
    async writeMedia(id, raw) {
        const db = await openDb();
        if (!db || !id) {
            return;
        }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(raw, `${MEDIA_KEY_PREFIX}${id}`);
        await txToPromise(tx);
    },
    async removeMedia(id) {
        const db = await openDb();
        if (!db || !id) {
            return;
        }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(`${MEDIA_KEY_PREFIX}${id}`);
        await txToPromise(tx);
    },
    async removeAllMedia() {
        const db = await openDb();
        if (!db) {
            return;
        }

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const keys = await requestToPromise(readTx.objectStore(STORE_NAME).getAllKeys());

        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const key of keys || []) {
            if (typeof key === 'string' && key.startsWith(MEDIA_KEY_PREFIX)) {
                store.delete(key);
            }
        }
        await txToPromise(tx);
    },
    async estimateSize() {
        const db = await openDb();
        if (!db) {
            return 0;
        }

        const tx = db.transaction(STORE_NAME, 'readonly');
        const values = await requestToPromise(tx.objectStore(STORE_NAME).getAll());
        return (values || []).reduce((total, value) => total + valueSize(value), 0);
    },
};

export function openLocalDataCache(key, { uid } = {}) {
    return openVaultCache({
        key,
        storage,
        uid,
        network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
    });
}
