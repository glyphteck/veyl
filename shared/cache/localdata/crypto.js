'use client';

import { AES_IV_BYTES, openAes, sealAes } from '../../crypto/aes.js';
import { cleanBytes, decoder, encoder, fromHexBytes, randomBytes, toBytes, toHex } from '../../crypto/core.js';
import { packVersionedData, unpackVersionedData } from '../../crypto/pack.js';
import { emptyPayload, LOCAL_DATA_CACHE_VERSION, normalizePayload } from './schema.js';

export const MEDIA_ENVELOPE_VERSION = 1;

export function makeCacheId() {
    return toHex(randomBytes(16));
}

function cacheAad(uid, network) {
    return encoder.encode(JSON.stringify(['veyl-local-cache', LOCAL_DATA_CACHE_VERSION, String(uid || ''), String(network || '')]));
}

function mediaAad(uid, network, id) {
    return encoder.encode(JSON.stringify(['veyl-local-cache-media', LOCAL_DATA_CACHE_VERSION, String(uid || ''), String(network || ''), String(id || '')]));
}

export async function sealPayload(key, payload, uid, network) {
    const body = encoder.encode(JSON.stringify({ ...normalizePayload(payload), savedAt: Date.now() }));
    try {
        const { iv, ct } = await sealAes(key, body, cacheAad(uid, network));
        return JSON.stringify({
            v: LOCAL_DATA_CACHE_VERSION,
            iv: toHex(iv),
            ct: toHex(ct),
        });
    } finally {
        cleanBytes(body);
    }
}

export async function openPayload(key, raw, uid, network) {
    if (!raw) {
        return emptyPayload();
    }

    const envelope = JSON.parse(raw);
    if (envelope?.v !== LOCAL_DATA_CACHE_VERSION || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
        throw new Error('unsupported local cache');
    }

    const plain = await openAes(key, fromHexBytes(envelope.iv, 'cache iv'), fromHexBytes(envelope.ct, 'cache ciphertext'), cacheAad(uid, network));
    try {
        return normalizePayload(JSON.parse(decoder.decode(plain)));
    } finally {
        cleanBytes(plain);
    }
}

function packMedia(iv, ct) {
    return packVersionedData(MEDIA_ENVELOPE_VERSION, iv, ct);
}

function unpackMedia(raw) {
    const { version, nonce, ct } = unpackVersionedData(raw, AES_IV_BYTES);
    if (version !== MEDIA_ENVELOPE_VERSION) {
        throw new Error('unsupported cached media');
    }
    return { iv: nonce, ct };
}

export async function sealMedia(key, bytes, uid, network, id) {
    const media = toBytes(bytes, 'media bytes');
    const { iv, ct } = await sealAes(key, media, mediaAad(uid, network, id));
    return packMedia(iv, ct);
}

export async function openMedia(key, raw, uid, network, id) {
    const { iv, ct } = unpackMedia(raw);
    return openAes(key, iv, ct, mediaAad(uid, network, id));
}

export function mediaCrypto(uid, network, id, keyBytes) {
    return {
        key: keyBytes,
        aad: mediaAad(uid, network, id),
        version: MEDIA_ENVELOPE_VERSION,
        ivBytes: AES_IV_BYTES,
    };
}
