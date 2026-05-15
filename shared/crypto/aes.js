'use client';

import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes, toBytes } from './core.js';

export const AES_IV_BYTES = 12;

export async function sealAes(key, plaintext, aad) {
    const keyBytes = toBytes(key, 'aes key');
    if (keyBytes.length !== 32) {
        throw new Error('Invalid AES key length');
    }

    const iv = randomBytes(AES_IV_BYTES);
    const pt = toBytes(plaintext, 'plaintext');
    const extra = aad == null ? undefined : toBytes(aad, 'aad');
    const ct = gcm(keyBytes, iv, extra).encrypt(pt);
    return { iv, ct: new Uint8Array(ct) };
}

export async function openAes(key, iv, ct, aad) {
    const keyBytes = toBytes(key, 'aes key');
    if (keyBytes.length !== 32) {
        throw new Error('Invalid AES key length');
    }

    const ivBytes = toBytes(iv, 'iv');
    const ctBytes = toBytes(ct, 'ciphertext');
    const extra = aad == null ? undefined : toBytes(aad, 'aad');
    const pt = gcm(keyBytes, ivBytes, extra).decrypt(ctBytes);
    return new Uint8Array(pt);
}
