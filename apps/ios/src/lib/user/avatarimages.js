import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { AVATAR_IMAGE_MAX_BYTES } from '@veyl/shared/config';
import { ensureDirectory } from '@/lib/file';

const CACHE_DIR = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}avatar-image-cache/` : null;
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

function cacheFile(url) {
    return CACHE_DIR ? `${CACHE_DIR}${hashUrl(url)}.webp` : null;
}

async function readExistingFile(uri) {
    if (!uri || !(await ensureDirectory(CACHE_DIR))) return null;
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    if (!info?.exists) return null;
    if (!Number.isFinite(info.size) || info.size <= 0 || info.size > AVATAR_IMAGE_MAX_BYTES) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        return null;
    }
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
        const uri = cacheFile(url);
        const existingFile = await readExistingFile(uri);
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
        return remember(url, uri);
    })()
        .catch(() => null)
        .finally(() => {
            pending.delete(url);
        });

    pending.set(url, job);
    return job;
}
