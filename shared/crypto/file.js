'use client';

import { cleanBytes, randomBytes, toBytes, toBytes32, toHex } from './core.js';
import { encodeScope } from './kdf.js';
import { packRawData, unpackBodyData } from './pack.js';

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

export function getFileAad(pair, scope) {
    return getFileAadForChat(pair?.chatId, scope);
}

export function getFileAadForChat(chatId, scope) {
    if (!chatId) {
        throw new Error('file chat id required');
    }
    if (!scope) {
        throw new Error('file scope required');
    }
    return encodeScope(FILE_SCOPE, [chatId, scope]);
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
export async function sealFile(pair, key, bytes, scope) {
    const chatId = pair?.chatId;
    const fileKey = new Uint8Array(toBytes32(key, 'file key'));
    try {
        const cryptoKey = await importAesKey(fileKey, ['encrypt']);
        const iv = randomBytes(FILE_IV_BYTES);
        const ct = await getSubtleCrypto().encrypt(
            {
                name: 'AES-GCM',
                iv,
                tagLength: FILE_TAG_BYTES * 8,
                additionalData: getFileAadForChat(chatId, scope),
            },
            cryptoKey,
            toBytes(bytes, 'plaintext')
        );
        return packRawData(iv, new Uint8Array(ct));
    } finally {
        cleanBytes(fileKey);
    }
}

export async function openFile(pair, key, body, scope) {
    return openFileForChat(pair?.chatId, key, body, scope);
}

export async function openFileForChat(chatId, key, body, scope) {
    const fileKey = new Uint8Array(toBytes32(key, 'file key'));
    try {
        const cryptoKey = await importAesKey(fileKey, ['decrypt']);
        const { nonce, ct } = unpackBodyData(body, FILE_IV_BYTES);
        const pt = await getSubtleCrypto().decrypt(
            {
                name: 'AES-GCM',
                iv: nonce,
                tagLength: FILE_TAG_BYTES * 8,
                additionalData: getFileAadForChat(chatId, scope),
            },
            cryptoKey,
            ct
        );
        return new Uint8Array(pt);
    } finally {
        cleanBytes(fileKey);
    }
}
