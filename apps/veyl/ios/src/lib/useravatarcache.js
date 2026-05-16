import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

const META_KEY_PREFIX = 'veyl.user.avatar.';
const CACHE_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}user-avatar-cache/` : null;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function metaKey(uid) {
    return `${META_KEY_PREFIX}${uid}`;
}

function readVersion(value) {
    const version = Number(value);
    return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function safeUid(uid) {
    return String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
}

function imageExtension(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
    return 'img';
}

function avatarFile(uid, version, ext) {
    if (!CACHE_DIR) return null;
    const safe = safeUid(uid);
    if (!safe) return null;
    return `${CACHE_DIR}${safe}-${version}.${ext || 'img'}`;
}

async function ensureDir() {
    if (!CACHE_DIR) return false;
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch((error) => {
        if (!/already exists/i.test(String(error?.message || error))) {
            throw error;
        }
    });
    return true;
}

async function removeFiles(uid, exceptUri = null) {
    if (!CACHE_DIR) return;
    const prefix = `${safeUid(uid)}-`;
    const names = await FileSystem.readDirectoryAsync(CACHE_DIR).catch(() => []);
    await Promise.all(
        (names || [])
            .filter((name) => name.startsWith(prefix))
            .map((name) => `${CACHE_DIR}${name}`)
            .filter((uri) => uri !== exceptUri)
            .map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}))
    );
}

async function removeFilesExceptUids(uids = []) {
    if (!CACHE_DIR) return;
    const keepPrefixes = new Set((uids || []).filter(Boolean).map((uid) => `${safeUid(uid)}-`));
    const names = await FileSystem.readDirectoryAsync(CACHE_DIR).catch(() => []);
    await Promise.all(
        (names || [])
            .filter((name) => ![...keepPrefixes].some((prefix) => name.startsWith(prefix)))
            .map((name) => FileSystem.deleteAsync(`${CACHE_DIR}${name}`, { idempotent: true }).catch(() => {}))
    );
}

async function readMeta(uid) {
    try {
        return JSON.parse((await AsyncStorage.getItem(metaKey(uid))) || 'null');
    } catch {
        return null;
    }
}

function isRemembered(meta) {
    return meta?.remember === true;
}

function readUsername(value) {
    return typeof value === 'string' ? value.trim().replace(/^@+/, '').slice(0, 40) : '';
}

function rememberMeta(meta, uid, account = null) {
    const username = readUsername(account?.username) || readUsername(meta?.username);
    return {
        ...(meta && typeof meta === 'object' ? meta : {}),
        uid,
        username,
        remember: true,
        rememberedAt: Number(meta?.rememberedAt) || Date.now(),
        lastLoginAt: Number(meta?.lastLoginAt) || 0,
        updatedAt: Date.now(),
    };
}

function avatarMeta(meta, uid) {
    const version = readVersion(meta?.version);
    const uri = typeof meta?.uri === 'string' ? meta.uri : '';
    return meta?.uid === uid && version != null && uri ? { uid, username: readUsername(meta?.username), version, uri, updatedAt: Date.now() } : null;
}

function rememberedMeta(meta) {
    if (!meta?.uid || !isRemembered(meta)) {
        return null;
    }
    return {
        uid: meta.uid,
        username: readUsername(meta.username),
        avatar: typeof meta.uri === 'string' ? meta.uri : null,
        rememberedAt: Number(meta.rememberedAt) || 0,
        lastLoginAt: Number(meta.lastLoginAt) || 0,
    };
}

export const userAvatarCache = {
    async read(uid) {
        if (!uid) return null;
        const meta = await readMeta(uid);
        const version = readVersion(meta?.version);
        const uri = typeof meta?.uri === 'string' ? meta.uri : '';
        if (meta?.uid !== uid || version == null || !uri) {
            return null;
        }

        const info = await FileSystem.getInfoAsync(uri).catch(() => null);
        if (!info?.exists || !Number.isFinite(info.size) || info.size <= 0 || info.size > MAX_IMAGE_BYTES) {
            await removeFiles(uid);
            if (isRemembered(meta)) {
                await AsyncStorage.setItem(metaKey(uid), JSON.stringify(rememberMeta({ uid, username: meta?.username, remember: true, rememberedAt: meta?.rememberedAt, lastLoginAt: meta?.lastLoginAt }, uid)));
            } else {
                await AsyncStorage.removeItem(metaKey(uid));
            }
            return null;
        }

        return { version, url: uri };
    },
    async write(uid, { version, bytes }) {
        if (!uid) return null;
        const nextVersion = readVersion(version);
        const body = asBytes(bytes);
        if (nextVersion == null || !body || body.byteLength <= 0 || body.byteLength > MAX_IMAGE_BYTES || !(await ensureDir())) {
            return null;
        }

        const uri = avatarFile(uid, nextVersion, imageExtension(body));
        if (!uri) return null;

        await FileSystem.writeAsStringAsync(uri, Buffer.from(body).toString('base64'), {
            encoding: FileSystem.EncodingType.Base64,
        });
        const previous = await readMeta(uid);
        await AsyncStorage.setItem(
            metaKey(uid),
            JSON.stringify({
                uid,
                username: readUsername(previous?.username),
                version: nextVersion,
                uri,
                remember: isRemembered(previous),
                rememberedAt: previous?.rememberedAt || null,
                lastLoginAt: previous?.lastLoginAt || null,
                updatedAt: Date.now(),
            })
        );
        await removeFiles(uid, uri);
        return uri;
    },
    async remember(uid, account = null) {
        if (!uid) return;
        await AsyncStorage.setItem(metaKey(uid), JSON.stringify(rememberMeta(await readMeta(uid), uid, account)));
    },
    async touchLogin(uid) {
        if (!uid) return;
        const meta = await readMeta(uid);
        if (!isRemembered(meta)) return;
        await AsyncStorage.setItem(metaKey(uid), JSON.stringify({ ...meta, lastLoginAt: Date.now(), updatedAt: Date.now() }));
    },
    async forget(uid) {
        if (!uid) return;
        const meta = await readMeta(uid);
        const avatar = avatarMeta(meta, uid);
        if (avatar) {
            await AsyncStorage.setItem(metaKey(uid), JSON.stringify({ ...avatar, remember: false, rememberedAt: null, lastLoginAt: null }));
        } else {
            await AsyncStorage.removeItem(metaKey(uid));
        }
    },
    async remove(uid) {
        if (!uid) return;
        const meta = await readMeta(uid);
        await removeFiles(uid);
        if (isRemembered(meta)) {
            await AsyncStorage.setItem(metaKey(uid), JSON.stringify(rememberMeta({ uid, username: meta?.username, remember: true, rememberedAt: meta?.rememberedAt, lastLoginAt: meta?.lastLoginAt }, uid)));
            return;
        }
        await AsyncStorage.removeItem(metaKey(uid));
    },
    async listRemembered() {
        const keys = await AsyncStorage.getAllKeys().catch(() => []);
        const avatarKeys = (keys || []).filter((key) => key.startsWith(META_KEY_PREFIX));
        const pairs = await AsyncStorage.multiGet(avatarKeys).catch(() => []);
        return pairs
            .map(([, raw]) => {
                try {
                    return rememberedMeta(JSON.parse(raw || 'null'));
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => (b.lastLoginAt || b.rememberedAt || 0) - (a.lastLoginAt || a.rememberedAt || 0));
    },
    async removeAllExcept(uid) {
        const keepKey = uid ? metaKey(uid) : '';
        const keys = await AsyncStorage.getAllKeys().catch(() => []);
        const avatarKeys = (keys || []).filter((key) => key.startsWith(META_KEY_PREFIX));
        const pairs = await AsyncStorage.multiGet(avatarKeys).catch(() => []);
        const rememberedUids = pairs
            .map(([key, raw]) => {
                try {
                    const meta = JSON.parse(raw || 'null');
                    return isRemembered(meta) ? key.slice(META_KEY_PREFIX.length) : null;
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
        const keepUids = [...new Set([uid, ...rememberedUids].filter(Boolean))];
        const removeKeys = avatarKeys.filter((key) => key !== keepKey && !rememberedUids.includes(key.slice(META_KEY_PREFIX.length)));
        await Promise.all([removeKeys.length ? AsyncStorage.multiRemove(removeKeys) : Promise.resolve(), removeFilesExceptUids(keepUids)]);
    },
    async removeAll() {
        const keys = await AsyncStorage.getAllKeys().catch(() => []);
        const avatarKeys = (keys || []).filter((key) => key.startsWith(META_KEY_PREFIX));
        const pairs = await AsyncStorage.multiGet(avatarKeys).catch(() => []);
        const rememberedUids = pairs
            .map(([key, raw]) => {
                try {
                    const meta = JSON.parse(raw || 'null');
                    return isRemembered(meta) ? key.slice(META_KEY_PREFIX.length) : null;
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
        const removeKeys = avatarKeys.filter((key) => !rememberedUids.includes(key.slice(META_KEY_PREFIX.length)));
        await Promise.all([removeKeys.length ? AsyncStorage.multiRemove(removeKeys) : Promise.resolve(), removeFilesExceptUids(rememberedUids)]);
    },
};
