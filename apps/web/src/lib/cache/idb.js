'use client';

export function idbRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export function idbTx(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
    });
}

export function openIdb(name, version, stores = []) {
    if (typeof indexedDB === 'undefined') {
        return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => {
            const db = request.result;
            for (const store of stores) {
                if (!db.objectStoreNames.contains(store)) {
                    db.createObjectStore(store);
                }
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export function createIdbOpener(name, version, stores = []) {
    let promise = null;
    return function openDb() {
        if (promise) {
            return promise;
        }

        promise = openIdb(name, version, stores).catch((error) => {
            promise = null;
            throw error;
        });

        return promise;
    };
}
