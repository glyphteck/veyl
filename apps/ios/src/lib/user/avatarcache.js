import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { bytesView, imageExtension } from '@veyl/shared/utils/image';
import { cleanAvatarUsername, compareRememberedAvatars, isRememberedAvatar, makeRememberedAvatar, readAvatarVersion, readRememberedAvatar } from '@veyl/shared/avatar';
import { uniqueValues } from '@veyl/shared/utils/array';
import { AVATAR_IMAGE_MAX_BYTES } from '@veyl/shared/config';
import { safeFilePart } from '@veyl/shared/utils/filename';
import { ensureDirectory } from '@/lib/file';

const META_KEY_PREFIX = 'veyl.user.avatar.';
const CACHE_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}user-avatar-cache/` : null;

function metaKey(uid) {
    return `${META_KEY_PREFIX}${uid}`;
}

function avatarFile(uid, version, ext) {
    if (!CACHE_DIR) return null;
    const safe = safeFilePart(uid, '');
    if (!safe) return null;
    return `${CACHE_DIR}${safe}-${version}.${ext || 'img'}`;
}

async function removeFiles(uid, exceptUri = null) {
    if (!CACHE_DIR) return;
    const prefix = `${safeFilePart(uid, '')}-`;
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
    const keepPrefixes = new Set((uids || []).filter(Boolean).map((uid) => `${safeFilePart(uid, '')}-`));
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

function avatarMeta(meta, uid) {
    const version = readAvatarVersion(meta?.version);
    const uri = typeof meta?.uri === 'string' ? meta.uri : '';
    return meta?.uid === uid && version != null && uri ? { uid, username: cleanAvatarUsername(meta?.username), version, uri, updatedAt: Date.now() } : null;
}

function rememberedMeta(meta) {
    const remembered = readRememberedAvatar(meta);
    if (!remembered) {
        return null;
    }
    return {
        ...remembered,
        avatar: typeof meta.uri === 'string' ? meta.uri : null,
    };
}

async function metaKeys() {
    const keys = await AsyncStorage.getAllKeys().catch(() => []);
    return (keys || []).filter((key) => key.startsWith(META_KEY_PREFIX));
}

function rememberedUidFromPair([key, raw]) {
    try {
        const meta = JSON.parse(raw || 'null');
        return isRememberedAvatar(meta) ? key.slice(META_KEY_PREFIX.length) : null;
    } catch {
        return null;
    }
}

async function rememberedUidsFromKeys(keys) {
    const pairs = await AsyncStorage.multiGet(keys).catch(() => []);
    return pairs.map(rememberedUidFromPair).filter(Boolean);
}

export const userAvatarCache = {
    async read(uid) {
        if (!uid) return null;
        const meta = await readMeta(uid);
        const version = readAvatarVersion(meta?.version);
        const uri = typeof meta?.uri === 'string' ? meta.uri : '';
        if (meta?.uid !== uid || version == null || !uri) {
            return null;
        }

        const info = await FileSystem.getInfoAsync(uri).catch(() => null);
        if (!info?.exists || !Number.isFinite(info.size) || info.size <= 0 || info.size > AVATAR_IMAGE_MAX_BYTES) {
            await removeFiles(uid);
            if (isRememberedAvatar(meta)) {
                await AsyncStorage.setItem(metaKey(uid), JSON.stringify(makeRememberedAvatar({ uid, username: meta?.username, rememberedAt: meta?.rememberedAt, lastLoginAt: meta?.lastLoginAt }, uid)));
            } else {
                await AsyncStorage.removeItem(metaKey(uid));
            }
            return null;
        }

        return { version, url: uri };
    },
    async write(uid, { version, bytes }) {
        if (!uid) return null;
        const nextVersion = readAvatarVersion(version);
        const body = bytesView(bytes);
        if (nextVersion == null || !body || body.byteLength <= 0 || body.byteLength > AVATAR_IMAGE_MAX_BYTES || !(await ensureDirectory(CACHE_DIR))) {
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
                username: cleanAvatarUsername(previous?.username),
                version: nextVersion,
                uri,
                remember: isRememberedAvatar(previous),
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
        await AsyncStorage.setItem(metaKey(uid), JSON.stringify(makeRememberedAvatar(await readMeta(uid), uid, account)));
    },
    async hasRemembered(uid) {
        if (!uid) return false;
        return isRememberedAvatar(await readMeta(uid));
    },
    async touchLogin(uid) {
        if (!uid) return;
        const meta = await readMeta(uid);
        if (!isRememberedAvatar(meta)) return;
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
        if (isRememberedAvatar(meta)) {
            await AsyncStorage.setItem(metaKey(uid), JSON.stringify(makeRememberedAvatar({ uid, username: meta?.username, rememberedAt: meta?.rememberedAt, lastLoginAt: meta?.lastLoginAt }, uid)));
            return;
        }
        await AsyncStorage.removeItem(metaKey(uid));
    },
    async listRemembered() {
        const avatarKeys = await metaKeys();
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
            .sort(compareRememberedAvatars);
    },
    async removeAllExcept(uid) {
        const keepKey = uid ? metaKey(uid) : '';
        const avatarKeys = await metaKeys();
        const rememberedUids = await rememberedUidsFromKeys(avatarKeys);
        const keepUids = uniqueValues([uid, ...rememberedUids]);
        const removeKeys = avatarKeys.filter((key) => key !== keepKey && !rememberedUids.includes(key.slice(META_KEY_PREFIX.length)));
        await Promise.all([removeKeys.length ? AsyncStorage.multiRemove(removeKeys) : Promise.resolve(), removeFilesExceptUids(keepUids)]);
    },
    async removeAll() {
        const avatarKeys = await metaKeys();
        const rememberedUids = await rememberedUidsFromKeys(avatarKeys);
        const removeKeys = avatarKeys.filter((key) => !rememberedUids.includes(key.slice(META_KEY_PREFIX.length)));
        await Promise.all([removeKeys.length ? AsyncStorage.multiRemove(removeKeys) : Promise.resolve(), removeFilesExceptUids(rememberedUids)]);
    },
};
