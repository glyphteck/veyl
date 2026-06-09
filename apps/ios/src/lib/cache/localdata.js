import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';

import { openVaultCache } from '@veyl/shared/cache/localdata';
import { resolveNetwork } from '@veyl/shared/network';
import { cleanBytes, fromHexBytes, randomBytes, toBytes, toHex } from '@veyl/shared/crypto/core';
import { deriveDeviceCacheKey } from '@veyl/shared/crypto/seed';
import { safeFilePart } from '@veyl/shared/utils/filename';
import { ensureDirectory } from '@/lib/file';

const CACHE_ROOT = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vault-local-cache/` : null;
const CACHE_SECRET_SERVICE = 'veyl.localcache';
const INSTALL_SECRET_BYTES = 32;
const MEDIA_TAG_BYTES = 16;
const STORE_OPTS = {
    keychainService: CACHE_SECRET_SERVICE,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
};

function storageScope(uid, network) {
    return `${safeFilePart(network)}-${safeFilePart(uid)}`;
}

function installSecretKey(uid, network) {
    return `veyl_local_cache_${safeFilePart(network)}_${safeFilePart(uid)}`;
}

function parseInstallSecret(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
        return null;
    }
    return fromHexBytes(value, 'local cache install secret');
}

async function readOrCreateInstallSecret(uid, network) {
    const key = installSecretKey(uid, network);
    const existing = parseInstallSecret(await SecureStore.getItemAsync(key, { keychainService: CACHE_SECRET_SERVICE }).catch(() => null));
    if (existing) {
        return existing;
    }

    const secret = randomBytes(INSTALL_SECRET_BYTES);
    try {
        await SecureStore.setItemAsync(key, toHex(secret), STORE_OPTS);
    } catch {}
    return secret;
}

async function localCacheKey(rootKey, { uid, network }) {
    const installSecret = await readOrCreateInstallSecret(uid, network);
    try {
        return deriveDeviceCacheKey(rootKey, installSecret, uid, network);
    } finally {
        cleanBytes(installSecret);
    }
}

function cacheDir(scope) {
    return CACHE_ROOT ? `${CACHE_ROOT}${scope}/` : null;
}

function cacheFile(scope) {
    const dir = cacheDir(scope);
    return dir ? `${dir}main.dat` : null;
}

function mediaDir(scope) {
    const dir = cacheDir(scope);
    return dir ? `${dir}media/` : null;
}

function mediaFile(dir, id) {
    const safeId = String(id || '').trim();
    if (!dir || !/^[a-z0-9]+$/i.test(safeId)) {
        return null;
    }
    return `${dir}${safeId}.dat`;
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

function makeStorage({ uid, network }) {
    const scope = storageScope(uid, network);
    const dir = cacheDir(scope);
    const mainFile = cacheFile(scope);
    const mediaDirectory = mediaDir(scope);

    return {
        async read() {
            if (!mainFile) {
                return null;
            }

            const info = await FileSystem.getInfoAsync(mainFile);
            if (!info.exists) {
                return null;
            }
            return FileSystem.readAsStringAsync(mainFile);
        },
        async write(raw) {
            if (!mainFile || !(await ensureDirectory(dir))) {
                return;
            }
            await FileSystem.writeAsStringAsync(mainFile, raw);
        },
        async remove() {
            if (!mainFile) {
                return;
            }
            await FileSystem.deleteAsync(mainFile, { idempotent: true });
        },
        async readMedia(id) {
            const file = mediaFile(mediaDirectory, id);
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
            const file = mediaFile(mediaDirectory, id);
            if (!file || !(await ensureDirectory(mediaDirectory))) {
                return;
            }
            const mediaFileRef = new File(file);
            mediaFileRef.create({ overwrite: true });
            mediaFileRef.write(toBytes(raw, 'cached media'));
        },
        async removeMedia(id) {
            const file = mediaFile(mediaDirectory, id);
            if (!file) {
                return;
            }
            await FileSystem.deleteAsync(file, { idempotent: true });
        },
        async removeAllMedia() {
            if (!mediaDirectory) {
                return;
            }
            await FileSystem.deleteAsync(mediaDirectory, { idempotent: true });
        },
        sealMedia(id, bytes, crypto) {
            return sealMediaNative(bytes, crypto);
        },
        openMedia(id, raw, crypto) {
            return openMediaNative(raw, crypto);
        },
        async estimateSize() {
            const [mainSize, mediaSize] = await Promise.all([fileSize(mainFile), directorySize(mediaDirectory)]);
            return mainSize + mediaSize;
        },
    };
}

export async function openLocalDataCache(key, { uid } = {}) {
    const network = resolveNetwork(globalThis?.process?.env ?? {});
    const cacheKey = await localCacheKey(key, { uid, network });
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
