import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { AVATAR_IMAGE_MAX_BYTES, LOCAL_AVATAR_CACHE_MAX_AGE_MS, LOCAL_AVATAR_CACHE_MAX_BYTES, LOCAL_AVATAR_CACHE_MAX_ITEMS } from '@veyl/shared/config';
import { ensureDirectory } from '@/lib/file';

const CACHE_DIR = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}avatar-image-cache/` : null;
const META_KEY = 'veyl.avatar-image-cache.meta';
const cached = new Map();
const pending = new Map();

function isRemoteUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
}

function hashUrl(url) {
    let hash = 0x811c9dc5;
    const text = String(url || '');
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${(hash >>> 0).toString(16).padStart(8, '0')}-${text.length.toString(36)}`;
}

function cacheFileFromId(id) {
    return CACHE_DIR && id ? `${CACHE_DIR}${id}.webp` : null;
}

async function readMeta() {
    try {
        const meta = JSON.parse((await AsyncStorage.getItem(META_KEY)) || '{}');
        return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
    } catch {
        return {};
    }
}

async function writeMeta(meta) {
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta && typeof meta === 'object' ? meta : {}));
}

function forgetCachedIds(ids) {
    if (!ids?.size) {
        return;
    }
    for (const url of cached.keys()) {
        if (ids.has(hashUrl(url))) {
            cached.delete(url);
        }
    }
}

async function pruneCache(metaInput = null) {
    if (!CACHE_DIR || !(await ensureDirectory(CACHE_DIR))) {
        return;
    }

    const now = Date.now();
    const meta = metaInput || (await readMeta());
    const names = await FileSystem.readDirectoryAsync(CACHE_DIR).catch(() => []);
    const knownFiles = new Set((names || []).filter((name) => name.endsWith('.webp')).map((name) => name.replace(/\.webp$/, '')));
    const entries = [];
    const removeIds = new Set();
    let totalBytes = 0;
    let count = 0;

    for (const id of Object.keys(meta)) {
        const file = cacheFileFromId(id);
        const info = file ? await FileSystem.getInfoAsync(file).catch(() => null) : null;
        const size = Number(info?.size) || Number(meta[id]?.size) || 0;
        const lastUsedAt = Number(meta[id]?.lastUsedAt) || 0;
        const valid = info?.exists && size > 0 && size <= AVATAR_IMAGE_MAX_BYTES && now - lastUsedAt <= LOCAL_AVATAR_CACHE_MAX_AGE_MS;
        knownFiles.delete(id);
        if (!valid) {
            removeIds.add(id);
            delete meta[id];
            continue;
        }
        count += 1;
        totalBytes += size;
        entries.push({ id, size, lastUsedAt });
    }

    for (const id of knownFiles) {
        removeIds.add(id);
    }

    entries.sort((a, b) => {
        const delta = a.lastUsedAt - b.lastUsedAt;
        if (delta !== 0) return delta;
        return a.id.localeCompare(b.id);
    });

    for (const entry of entries) {
        if (count <= LOCAL_AVATAR_CACHE_MAX_ITEMS && totalBytes <= LOCAL_AVATAR_CACHE_MAX_BYTES) {
            break;
        }
        removeIds.add(entry.id);
        delete meta[entry.id];
        count -= 1;
        totalBytes -= entry.size;
    }

    await Promise.all([...removeIds].map((id) => FileSystem.deleteAsync(cacheFileFromId(id), { idempotent: true }).catch(() => {})));
    forgetCachedIds(removeIds);
    await writeMeta(meta);
}

async function touchCacheEntry(id, size) {
    const meta = await readMeta();
    meta[id] = {
        size: Number(size) || 0,
        lastUsedAt: Date.now(),
    };
    await writeMeta(meta);
    void pruneCache(meta);
}

async function readExistingFile(id, uri) {
    if (!uri || !(await ensureDirectory(CACHE_DIR))) return null;
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    if (!info?.exists) return null;
    if (!Number.isFinite(info.size) || info.size <= 0 || info.size > AVATAR_IMAGE_MAX_BYTES) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        return null;
    }
    await touchCacheEntry(id, info.size);
    return uri;
}

function remember(url, uri) {
    cached.set(url, uri);
    return uri;
}

export function readAvatarImageCache(url) {
    return cached.get(url) || null;
}

export async function loadAvatarImageCache(url) {
    if (!isRemoteUrl(url)) return null;
    const existing = cached.get(url);
    if (existing) return existing;
    const current = pending.get(url);
    if (current) return current;

    const job = (async () => {
        const id = hashUrl(url);
        const uri = cacheFileFromId(id);
        const existingFile = await readExistingFile(id, uri);
        if (existingFile) return remember(url, existingFile);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`avatar download failed (${response.status})`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!uri || bytes.byteLength <= 0 || bytes.byteLength > AVATAR_IMAGE_MAX_BYTES || !(await ensureDirectory(CACHE_DIR))) {
            return null;
        }

        await FileSystem.writeAsStringAsync(uri, Buffer.from(bytes).toString('base64'), {
            encoding: FileSystem.EncodingType.Base64,
        });
        await touchCacheEntry(id, bytes.byteLength);
        return remember(url, uri);
    })()
        .catch(() => null)
        .finally(() => {
            pending.delete(url);
        });

    pending.set(url, job);
    return job;
}
