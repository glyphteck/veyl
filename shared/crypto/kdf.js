'use client';

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { encoder } from './core.js';

const ROOT_SALT = encoder.encode('GLYPHTECK');

function listParts(parts = []) {
    if (Array.isArray(parts)) {
        return parts;
    }
    return [parts];
}

export function encodeScope(label, parts = []) {
    return encoder.encode(JSON.stringify([label, ...listParts(parts)]));
}

export function deriveKey(input, label, parts = [], size = 32) {
    return hkdf(sha256, input, ROOT_SALT, encodeScope(label, parts), size);
}
