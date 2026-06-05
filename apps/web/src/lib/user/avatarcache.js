import { bytesView, imageMimeType } from '@veyl/shared/utils/image';
import { cleanAvatarUsername, compareRememberedAvatars, isRememberedAvatar, makeRememberedAvatar, readAvatarVersion, readRememberedAvatar } from '@veyl/shared/avatar';
import { AVATAR_IMAGE_MAX_BYTES, LOCAL_AVATAR_CACHE_MAX_AGE_MS, LOCAL_AVATAR_CACHE_MAX_BYTES, LOCAL_AVATAR_CACHE_MAX_ITEMS, LOCAL_AVATAR_CACHE_TOUCH_MIN_MS } from '@veyl/shared/config';
import { createIdbOpener, idbRequest, idbTx } from '@/lib/cache/idb';

const DB_NAME = 'veyl-user-avatar-cache';
const DB_VERSION = 1;
const STORE_NAME = 'avatars';

const openDb = createIdbOpener(DB_NAME, DB_VERSION, [STORE_NAME]);
const objectUrls = new Map();

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

function avatarBlob(record) {
    const version = readAvatarVersion(record?.version);
    const blob = record?.blob instanceof Blob ? record.blob : null;
    return version != null && blob && blob.size > 0 && blob.size <= AVATAR_IMAGE_MAX_BYTES ? { version, blob } : null;
}

function lastUsedAt(record) {
    return Number(record?.lastUsedAt) || 0;
}

function isExpiredRecord(record, now = Date.now()) {
    return !isRememberedAvatar(record) && now - lastUsedAt(record) > LOCAL_AVATAR_CACHE_MAX_AGE_MS;
}

function readRecord(record, uid, now = Date.now()) {
    const avatar = avatarBlob(record);
    if (record?.uid !== uid || !avatar || isExpiredRecord(record, now)) {
        return null;
    }
    return { uid, username: cleanAvatarUsername(record?.username), version: avatar.version, url: makeObjectUrl(uid, avatar.version, avatar.blob) };
}

function avatarRecord(record, uid) {
    const avatar = avatarBlob(record);
    return record?.uid === uid && avatar ? { uid, username: cleanAvatarUsername(record?.username), version: avatar.version, blob: avatar.blob, lastUsedAt: Date.now() } : null;
}

function rememberedRecord(record) {
    const remembered = readRememberedAvatar(record);
    if (!remembered) {
        return null;
    }
    const avatar = readRecord(record, record.uid);
    return {
        ...remembered,
        avatar: avatar?.url || null,
    };
}

function hasRememberedRecord(store) {
    return new Promise((resolve, reject) => {
        const request = store.openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve(false);
                return;
            }
            if (isRememberedAvatar(cursor.value)) {
                resolve(true);
                return;
            }
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
    });
}

async function idbEntries(db) {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const [keys, records] = await Promise.all([idbRequest(store.getAllKeys()), idbRequest(store.getAll())]);
    return { keys: keys || [], records: records || [] };
}

async function pruneAvatarCache(db) {
    const now = Date.now();
    const { keys, records } = await idbEntries(db);
    const removable = [];
    let totalBytes = 0;
    let count = 0;

    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        const record = records[i];
        if (isRememberedAvatar(record)) {
            continue;
        }
        const avatar = avatarBlob(record);
        if (!avatar || record?.uid !== key || isExpiredRecord(record, now)) {
            removable.push({ key, remove: true });
            continue;
        }
        const size = avatar.blob.size;
        count += 1;
        totalBytes += size;
        removable.push({ key, size, lastUsedAt: lastUsedAt(record), remove: false });
    }

    removable.sort((a, b) => {
        const delta = (Number(a.lastUsedAt) || 0) - (Number(b.lastUsedAt) || 0);
        if (delta !== 0) return delta;
        return String(a.key || '').localeCompare(String(b.key || ''));
    });

    const deleteKeys = [];
    for (const entry of removable) {
        if (entry.remove) {
            deleteKeys.push(entry.key);
            continue;
        }
        if (count <= LOCAL_AVATAR_CACHE_MAX_ITEMS && totalBytes <= LOCAL_AVATAR_CACHE_MAX_BYTES) {
            continue;
        }
        deleteKeys.push(entry.key);
        count -= 1;
        totalBytes -= Number(entry.size) || 0;
    }

    if (!deleteKeys.length) {
        return;
    }
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const key of deleteKeys) {
        store.delete(key);
        revokeUrlsForUid(key);
    }
    await idbTx(tx);
}

async function removeUnrememberedEntries(db, keepUid = null) {
    const { keys, records } = await idbEntries(db);
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (key !== keepUid && !isRememberedAvatar(records[i])) {
            store.delete(key);
        }
    }
    await idbTx(tx);
}

export const userAvatarCache = {
    async read(uid) {
        if (!uid) return null;
        const db = await openDb();
        if (!db) return null;

        const now = Date.now();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const record = await idbRequest(tx.objectStore(STORE_NAME).get(uid));
        const avatar = readRecord(record, uid, now);
        if (!avatar) {
            await pruneAvatarCache(db);
            return null;
        }
        if (now - lastUsedAt(record) >= LOCAL_AVATAR_CACHE_TOUCH_MIN_MS) {
            const touchTx = db.transaction(STORE_NAME, 'readwrite');
            touchTx.objectStore(STORE_NAME).put({ ...record, lastUsedAt: now }, uid);
            await idbTx(touchTx);
        }
        void pruneAvatarCache(db);
        return avatar;
    },
    async write(uid, { version, bytes }) {
        if (!uid) return null;
        const nextVersion = readAvatarVersion(version);
        const body = bytesView(bytes);
        if (nextVersion == null || !body || body.byteLength <= 0 || body.byteLength > AVATAR_IMAGE_MAX_BYTES) {
            return null;
        }

        const db = await openDb();
        if (!db) return null;

        const blob = new Blob([body], { type: imageMimeType(body) });
        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await idbRequest(readTx.objectStore(STORE_NAME).get(uid));
        const now = Date.now();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
            uid,
            username: cleanAvatarUsername(previous?.username),
            version: nextVersion,
            blob,
            remember: isRememberedAvatar(previous),
            rememberedAt: previous?.rememberedAt || null,
            lastLoginAt: previous?.lastLoginAt || null,
            lastUsedAt: now,
            updatedAt: now,
        }, uid);
        await idbTx(tx);
        void pruneAvatarCache(db);
        return makeObjectUrl(uid, nextVersion, blob, { replace: true });
    },
    async remember(uid, account = null) {
        if (!uid) return;
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await idbRequest(readTx.objectStore(STORE_NAME).get(uid));
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(makeRememberedAvatar(previous, uid, account), uid);
        await idbTx(tx);
    },
    async hasRemembered(uid) {
        if (!uid) return false;
        const db = await openDb();
        if (!db) return false;

        const tx = db.transaction(STORE_NAME, 'readonly');
        return isRememberedAvatar(await idbRequest(tx.objectStore(STORE_NAME).get(uid)));
    },
    async hasRememberedAccount() {
        const db = await openDb();
        if (!db) return false;

        const tx = db.transaction(STORE_NAME, 'readonly');
        return hasRememberedRecord(tx.objectStore(STORE_NAME));
    },
    async touchLogin(uid) {
        if (!uid) return;
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await idbRequest(readTx.objectStore(STORE_NAME).get(uid));
        if (!isRememberedAvatar(previous)) {
            return;
        }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ ...previous, lastLoginAt: Date.now(), updatedAt: Date.now() }, uid);
        await idbTx(tx);
    },
    async forget(uid) {
        if (!uid) return;
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await idbRequest(readTx.objectStore(STORE_NAME).get(uid));
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
        await idbTx(tx);
    },
    async remove(uid) {
        if (!uid) return;
        revokeUrlsForUid(uid);
        const db = await openDb();
        if (!db) return;

        const readTx = db.transaction(STORE_NAME, 'readonly');
        const previous = await idbRequest(readTx.objectStore(STORE_NAME).get(uid));
        const tx = db.transaction(STORE_NAME, 'readwrite');
        if (isRememberedAvatar(previous)) {
            tx.objectStore(STORE_NAME).put(makeRememberedAvatar({ uid, username: previous?.username, rememberedAt: previous?.rememberedAt }, uid), uid);
        } else {
            tx.objectStore(STORE_NAME).delete(uid);
        }
        await idbTx(tx);
    },
    async listRemembered() {
        const db = await openDb();
        if (!db) return [];

        const tx = db.transaction(STORE_NAME, 'readonly');
        const records = await idbRequest(tx.objectStore(STORE_NAME).getAll());
        return (records || [])
            .map(rememberedRecord)
            .filter(Boolean)
            .sort(compareRememberedAvatars);
    },
    async removeAllExcept(uid) {
        revokeUrlsExcept(uid);
        const db = await openDb();
        if (!db) return;

        await removeUnrememberedEntries(db, uid);
    },
    async removeAll() {
        revokeUrlsExcept(null);
        const db = await openDb();
        if (!db) return;

        await removeUnrememberedEntries(db);
    },
};
