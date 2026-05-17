const DB_NAME = 'veyl-user-avatar-cache';
const DB_VERSION = 1;
const STORE_NAME = 'avatars';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

let dbPromise = null;
const objectUrls = new Map();

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

function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
}

function imageType(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return 'application/octet-stream';
}

function readVersion(value) {
    const version = Number(value);
    return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function objectUrlKey(uid, version) {
    return `${uid}:${version}`;
}

function revokeUrlsForUid(uid) {
    for (const [key, url] of objectUrls.entries()) {
        if (key.startsWith(`${uid}:`)) {
            URL.revokeObjectURL(url);
            objectUrls.delete(key);
        }
    }
}

function revokeUrlsExcept(uid) {
    for (const [key, url] of objectUrls.entries()) {
        if (!uid || !key.startsWith(`${uid}:`)) {
            URL.revokeObjectURL(url);
            objectUrls.delete(key);
        }
    }
}

function makeObjectUrl(uid, version, blob, { replace = false } = {}) {
    const key = objectUrlKey(uid, version);
    const existing = objectUrls.get(key);
    if (existing && !replace) {
        return existing;
    }
    if (existing) {
        URL.revokeObjectURL(existing);
    }
    const nextUrl = URL.createObjectURL(blob);
    objectUrls.set(key, nextUrl);
    return nextUrl;
}

function readRecord(record, uid) {
    const version = readVersion(record?.version);
    const blob = record?.blob instanceof Blob ? record.blob : null;
    if (record?.uid !== uid || version == null || !blob || blob.size <= 0 || blob.size > MAX_IMAGE_BYTES) {
        return null;
    }
    return { uid, username: readUsername(record?.username), version, url: makeObjectUrl(uid, version, blob) };
}

function isRemembered(record) {
    return record?.remember === true;
}

function readUsername(value) {
    return typeof value === 'string' ? value.trim().replace(/^@+/, '').slice(0, 40) : '';
}

function rememberRecord(record, uid, account = null) {
    const username = readUsername(account?.username) || readUsername(record?.username);
    return {
        ...(record && typeof record === 'object' ? record : {}),
        uid,
        username,
        remember: true,
        rememberedAt: Number(record?.rememberedAt) || Date.now(),
        lastLoginAt: Number(record?.lastLoginAt) || 0,
        updatedAt: Date.now(),
    };
}

function avatarRecord(record, uid) {
    const version = readVersion(record?.version);
    const blob = record?.blob instanceof Blob ? record.blob : null;
    return record?.uid === uid && version != null && blob && blob.size > 0 && blob.size <= MAX_IMAGE_BYTES ? { uid, username: readUsername(record?.username), version, blob, updatedAt: Date.now() } : null;
}

function rememberedRecord(record) {
    if (!record?.uid || !isRemembered(record)) {
        return null;
    }
    const avatar = readRecord(record, record.uid);
    return {
        uid: record.uid,
        username: readUsername(record.username),
        avatar: avatar?.url || null,
        rememberedAt: Number(record.rememberedAt) || 0,
        lastLoginAt: Number(record.lastLoginAt) || 0,
    };
}

export const userAvatarCache = {
    async read(uid) {
        if (!uid) return null;
        const db = await openDb();
        if (!db) return null;

        const tx = db.transaction(STORE_NAME, 'readonly');
        return readRecord(await requestToPromise(tx.objectStore(STORE_NAME).get(uid)), uid);
    },
    async write(uid, { version, bytes }) {
        if (!uid) return null;
        const nextVersion = readVersion(version);
        const body = asBytes(bytes);
        if (nextVersion == null || !body || body.byteLength <= 0 || body.byteLength > MAX_IMAGE_BYTES) {
            return null;
        }

        const db = await openDb();
        if (!db) return null;

        const blob = new Blob([body], { type: imageType(body) });
        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await requestToPromise(readTx.objectStore(STORE_NAME).get(uid));
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
            uid,
            username: readUsername(previous?.username),
            version: nextVersion,
            blob,
            remember: isRemembered(previous),
            rememberedAt: previous?.rememberedAt || null,
            lastLoginAt: previous?.lastLoginAt || null,
            updatedAt: Date.now(),
        }, uid);
        await txToPromise(tx);
        return makeObjectUrl(uid, nextVersion, blob, { replace: true });
    },
    async remember(uid, account = null) {
        if (!uid) return;
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await requestToPromise(readTx.objectStore(STORE_NAME).get(uid));
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(rememberRecord(previous, uid, account), uid);
        await txToPromise(tx);
    },
    async hasRemembered(uid) {
        if (!uid) return false;
        const db = await openDb();
        if (!db) return false;

        const tx = db.transaction(STORE_NAME, 'readonly');
        return isRemembered(await requestToPromise(tx.objectStore(STORE_NAME).get(uid)));
    },
    async touchLogin(uid) {
        if (!uid) return;
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await requestToPromise(readTx.objectStore(STORE_NAME).get(uid));
        if (!isRemembered(previous)) {
            return;
        }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ ...previous, lastLoginAt: Date.now(), updatedAt: Date.now() }, uid);
        await txToPromise(tx);
    },
    async forget(uid) {
        if (!uid) return;
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await requestToPromise(readTx.objectStore(STORE_NAME).get(uid));
        const avatar = avatarRecord(previous, uid);
        if (!avatar) {
            revokeUrlsForUid(uid);
        }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        if (avatar) {
            tx.objectStore(STORE_NAME).put({ ...avatar, remember: false, rememberedAt: null, lastLoginAt: null }, uid);
        } else {
            tx.objectStore(STORE_NAME).delete(uid);
        }
        await txToPromise(tx);
    },
    async remove(uid) {
        if (!uid) return;
        revokeUrlsForUid(uid);
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await requestToPromise(readTx.objectStore(STORE_NAME).get(uid));
        const tx = db.transaction(STORE_NAME, 'readwrite');
        if (isRemembered(previous)) {
            tx.objectStore(STORE_NAME).put(rememberRecord({ uid, username: previous?.username, remember: true, rememberedAt: previous?.rememberedAt }, uid), uid);
        } else {
            tx.objectStore(STORE_NAME).delete(uid);
        }
        await txToPromise(tx);
    },
    async listRemembered() {
        const db = await openDb();
        if (!db) return [];

        const tx = db.transaction(STORE_NAME, 'readonly');
        const records = await requestToPromise(tx.objectStore(STORE_NAME).getAll());
        return (records || [])
            .map(rememberedRecord)
            .filter(Boolean)
            .sort((a, b) => (b.lastLoginAt || b.rememberedAt || 0) - (a.lastLoginAt || a.rememberedAt || 0));
    },
    async removeAllExcept(uid) {
        revokeUrlsExcept(uid);
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const readStore = readTx.objectStore(STORE_NAME);
        const [keys, records] = await Promise.all([requestToPromise(readStore.getAllKeys()), requestToPromise(readStore.getAll())]);
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (let i = 0; i < (keys || []).length; i += 1) {
            const key = keys[i];
            if (key !== uid && !isRemembered(records[i])) {
                store.delete(key);
            }
        }
        await txToPromise(tx);
    },
    async removeAll() {
        revokeUrlsExcept(null);
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const readStore = readTx.objectStore(STORE_NAME);
        const [keys, records] = await Promise.all([requestToPromise(readStore.getAllKeys()), requestToPromise(readStore.getAll())]);
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (let i = 0; i < (keys || []).length; i += 1) {
            if (!isRemembered(records[i])) {
                store.delete(keys[i]);
            }
        }
        await txToPromise(tx);
    },
};
