'use client';

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { decoder, encoder, randomBytes, toBytes } from './core.js';

export const BOX_NONCE_BYTES = 24;

export async function sealBox(key, plaintext, aad) {
    const keyBytes = toBytes(key, 'box key');
    if (keyBytes.length !== 32) {
        throw new Error('Invalid box key length');
    }

    const nonce = randomBytes(BOX_NONCE_BYTES);
    const pt = toBytes(plaintext, 'plaintext');
    const extra = aad == null ? undefined : toBytes(aad, 'aad');
    const ct = xchacha20poly1305(keyBytes, nonce, extra).encrypt(pt);
    return { nonce, ct: new Uint8Array(ct) };
}

export async function openBox(key, nonce, ct, aad) {
    const keyBytes = toBytes(key, 'box key');
    if (keyBytes.length !== 32) {
        throw new Error('Invalid box key length');
    }

    const nonceBytes = toBytes(nonce, 'nonce');
    const ctBytes = toBytes(ct, 'ciphertext');
    const extra = aad == null ? undefined : toBytes(aad, 'aad');
    const pt = xchacha20poly1305(keyBytes, nonceBytes, extra).decrypt(ctBytes);
    return new Uint8Array(pt);
}

export async function sealJson(key, value, aad) {
    return sealBox(key, encoder.encode(JSON.stringify(value)), aad);
}

export async function openJson(key, nonce, ct, aad) {
    const bytes = await openBox(key, nonce, ct, aad);
    return JSON.parse(decoder.decode(bytes));
}
