'use client';

// Crypto constants
export const SALT_BYTES = 16;

// Shared crypto utilities
export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

// Argon2 parameters
export const MEM_KIB = 32 * 1024;
export const ITER = 4;
export const PAR = 1;

export function randomBytes(length) {
    const out = new Uint8Array(length);
    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(out);
        return out;
    }
    throw new Error('crypto.getRandomValues is not available in this environment');
}

export function toBytes(value, label = 'bytes') {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (typeof value === 'string') {
        return encoder.encode(value);
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new Error(`Invalid ${label}`);
}

// Generic key normalizer - converts strings or Uint8Arrays to 32-byte Uint8Array
export function toBytes32(k, label = 'key') {
    if (k instanceof Uint8Array) {
        if (k.length !== 32) throw new Error(`Invalid ${label} key length`);
        return k;
    }
    if (typeof k === 'string') {
        return fromHex(k, label);
    }
    throw new Error(`${label} key must be Uint8Array or 64-char hex`);
}

export function toHex(value) {
    return Array.from(toBytes(value)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex, label = 'hex') {
    if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error(`Invalid ${label} hex`);
    }
    return new Uint8Array(hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
}

export function cleanBytes(...values) {
    for (const value of values) {
        try {
            value?.fill?.(0);
        } catch {}
    }
}
