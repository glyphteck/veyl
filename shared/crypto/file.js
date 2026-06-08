'use client';

import { cleanBytes, randomBytes, toBytes, toBytes32, toHex } from './core.js';
import { encodeScope } from './kdf.js';
import { packBodyData, unpackBodyData } from './pack.js';

const FILE_SCOPE = 'file-body';
export const FILE_CRYPTO = 'aes-gcm';
export const FILE_IV_BYTES = 12;
export const FILE_TAG_BYTES = 16;

export function createFileKey() {
    return randomBytes(32);
}

export function encodeFileKey(key) {
    return toHex(toBytes32(key, 'file key'));
}

export function decodeFileKey(key) {
    return toBytes32(key, 'file key');
}

export function getFileAadForPath(scope) {
    if (!scope) {
        throw new Error('file scope required');
    }
    return encodeScope(FILE_SCOPE, [scope]);
}

export function getFileAad(_pair, scope) {
    return getFileAadForPath(scope);
}

function getSubtleCrypto() {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('WebCrypto AES-GCM unavailable');
    }
    return subtle;
}

async function importAesKey(key, usages) {
    return getSubtleCrypto().importKey('raw', toBytes32(key, 'file key'), { name: 'AES-GCM' }, false, usages);
}

// Scope should include a stable object id so a blob can't be replayed onto another path.
export async function sealFile(_pair, key, bytes, scope) {
    const fileKey = new Uint8Array(toBytes32(key, 'file key'));
    try {
        const cryptoKey = await importAesKey(fileKey, ['encrypt']);
        const iv = randomBytes(FILE_IV_BYTES);
        const ct = await getSubtleCrypto().encrypt(
            {
                name: 'AES-GCM',
                iv,
                tagLength: FILE_TAG_BYTES * 8,
                additionalData: getFileAadForPath(scope),
            },
            cryptoKey,
            toBytes(bytes, 'plaintext')
        );
        return packBodyData(iv, new Uint8Array(ct));
    } finally {
        cleanBytes(fileKey);
    }
}

export async function openFile(_pair, key, body, scope) {
    return openFileForPath(key, body, scope);
}

export async function openFileForPath(key, body, scope) {
    const fileKey = new Uint8Array(toBytes32(key, 'file key'));
    try {
        const cryptoKey = await importAesKey(fileKey, ['decrypt']);
        const { nonce, ct } = unpackBodyData(body, FILE_IV_BYTES);
        const pt = await getSubtleCrypto().decrypt(
            {
                name: 'AES-GCM',
                iv: nonce,
                tagLength: FILE_TAG_BYTES * 8,
                additionalData: getFileAadForPath(scope),
            },
            cryptoKey,
            ct
        );
        return new Uint8Array(pt);
    } finally {
        cleanBytes(fileKey);
    }
}
