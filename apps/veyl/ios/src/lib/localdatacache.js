import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import { Buffer } from 'buffer';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';

import { openVaultCache } from '@glyphteck/shared/localdatacache';
import { resolveNetwork } from '@glyphteck/shared/network';
import { cleanBytes, randomBytes, toBytes } from '@glyphteck/shared/crypto/core';

const CACHE_FILE = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vault-local-cache.dat` : null;
const MEDIA_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vault-local-cache-media/` : null;
const MEDIA_TAG_BYTES = 16;

function mediaFile(id) {
    const safeId = String(id || '').trim();
    if (!MEDIA_DIR || !/^[a-z0-9]+$/i.test(safeId)) {
        return null;
    }
    return `${MEDIA_DIR}${safeId}.dat`;
}

async function ensureMediaDir() {
    if (!MEDIA_DIR) {
        return false;
    }
    await FileSystem.makeDirectoryAsync(MEDIA_DIR, { intermediates: true }).catch((error) => {
        if (!/already exists/i.test(String(error?.message || error))) {
            throw error;
        }
    });
    return true;
}

async function fileSize(path) {
    if (!path) {
        return 0;
    }
    const info = await FileSystem.getInfoAsync(path).catch(() => null);
    return info?.exists && Number.isFinite(info.size) ? info.size : 0;
}

async function directorySize(path) {
    if (!path) {
        return 0;
    }
    const info = await FileSystem.getInfoAsync(path).catch(() => null);
    if (!info?.exists) {
        return 0;
    }
    const names = await FileSystem.readDirectoryAsync(path).catch(() => []);
    const sizes = await Promise.all((names || []).map((name) => fileSize(`${path}${name}`)));
    return sizes.reduce((total, size) => total + size, 0);
}

function packMedia(version, iv, ct) {
    const out = new Uint8Array(1 + iv.byteLength + ct.byteLength);
    out[0] = version;
    out.set(iv, 1);
    out.set(ct, 1 + iv.byteLength);
    return out;
}

function unpackMedia(raw, version, ivBytes) {
    const bytes = toBytes(raw, 'cached media');
    if (bytes.byteLength <= 1 + ivBytes || bytes[0] !== version) {
        throw new Error('unsupported cached media');
    }
    return {
        iv: bytes.slice(1, 1 + ivBytes),
        ct: bytes.slice(1 + ivBytes),
    };
}

async function sealMediaNative(bytes, { key, aad, version, ivBytes }) {
    const keyBytes = new Uint8Array(key);
    try {
        const aesKey = await AESEncryptionKey.import(keyBytes);
        const sealed = await aesEncryptAsync(toBytes(bytes, 'media bytes'), aesKey, {
            nonce: { bytes: randomBytes(ivBytes) },
            additionalData: aad,
        });
        const iv = new Uint8Array(await sealed.iv());
        const ct = new Uint8Array(await sealed.ciphertext({ includeTag: true }));
        return packMedia(version, iv, ct);
    } finally {
        cleanBytes(keyBytes);
    }
}

async function openMediaNative(raw, { key, aad, version, ivBytes }) {
    const keyBytes = new Uint8Array(key);
    try {
        const aesKey = await AESEncryptionKey.import(keyBytes);
        const { iv, ct } = unpackMedia(raw, version, ivBytes);
        const sealed = AESSealedData.fromParts(iv, ct, MEDIA_TAG_BYTES);
        return new Uint8Array(
            await aesDecryptAsync(sealed, aesKey, {
                additionalData: aad,
            })
        );
    } finally {
        cleanBytes(keyBytes);
    }
}

const storage = {
    async read() {
        if (!CACHE_FILE) {
            return null;
        }

        const info = await FileSystem.getInfoAsync(CACHE_FILE);
        if (!info.exists) {
            return null;
        }
        return FileSystem.readAsStringAsync(CACHE_FILE);
    },
    async write(raw) {
        if (!CACHE_FILE) {
            return;
        }
        await FileSystem.writeAsStringAsync(CACHE_FILE, raw);
    },
    async remove() {
        if (!CACHE_FILE) {
            return;
        }
        await FileSystem.deleteAsync(CACHE_FILE, { idempotent: true });
    },
    async readMedia(id) {
        const file = mediaFile(id);
        if (!file) {
            return null;
        }
        const info = await FileSystem.getInfoAsync(file);
        if (!info.exists) {
            return null;
        }
        try {
            return new Uint8Array(await new File(file).bytes());
        } catch {}
        const base64 = await FileSystem.readAsStringAsync(file, {
            encoding: FileSystem.EncodingType.Base64,
        });
        return new Uint8Array(Buffer.from(base64, 'base64'));
    },
    async writeMedia(id, raw) {
        const file = mediaFile(id);
        if (!file || !(await ensureMediaDir())) {
            return;
        }
        await FileSystem.writeAsStringAsync(file, Buffer.from(raw).toString('base64'), {
            encoding: FileSystem.EncodingType.Base64,
        });
    },
    async removeMedia(id) {
        const file = mediaFile(id);
        if (!file) {
            return;
        }
        await FileSystem.deleteAsync(file, { idempotent: true });
    },
    async removeAllMedia() {
        if (!MEDIA_DIR) {
            return;
        }
        await FileSystem.deleteAsync(MEDIA_DIR, { idempotent: true });
    },
    sealMedia(id, bytes, crypto) {
        return sealMediaNative(bytes, crypto);
    },
    openMedia(id, raw, crypto) {
        return openMediaNative(raw, crypto);
    },
    async estimateSize() {
        const [mainSize, mediaSize] = await Promise.all([fileSize(CACHE_FILE), directorySize(MEDIA_DIR)]);
        return mainSize + mediaSize;
    },
};

export function openLocalDataCache(key, { uid } = {}) {
    return openVaultCache({
        key,
        storage,
        uid,
        network: resolveNetwork(globalThis?.process?.env ?? {}),
    });
}
