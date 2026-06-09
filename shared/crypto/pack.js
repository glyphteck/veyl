import { sha256 } from '@noble/hashes/sha2.js';
import { AES_IV_BYTES } from './aes.js';
import { BOX_NONCE_BYTES } from './box.js';
import { decoder, encoder, SALT_BYTES, toBytes, toHex } from './core.js';
import { SECRET_REGISTRY_ENVELOPE_VERSION, VAULT_CRYPTO, VAULT_KDF, vaultIncompatibleError } from './seed.js';

const SEED_MAGIC = encoder.encode(VAULT_CRYPTO);
const SEED_CT_LENGTH_BYTES = 4;
export const LEGACY_V2_VAULT_CRYPTO = 'crypto_glyphseal_v2';
export const BODY_ENVELOPE_VERSION = 1;

export const concatBytes = (...arrs) => {
    let len = 0;
    const bytes = arrs.map((arr) => toBytes(arr, 'packed bytes'));
    for (const item of bytes) len += item.length;
    const out = new Uint8Array(len);
    let offset = 0;
    for (const item of bytes) {
        out.set(item, offset);
        offset += item.length;
    }
    return out;
};

function packRegistryData(registry) {
    if (registry?.v !== SECRET_REGISTRY_ENVELOPE_VERSION || !registry?.iv || !registry?.ct) {
        throw new Error('secret registry missing');
    }
    return concatBytes(new Uint8Array([SECRET_REGISTRY_ENVELOPE_VERSION]), registry.iv, registry.ct);
}

function unpackRegistryData(bytes) {
    const p = toBytes(bytes, 'secret registry');
    if (p.byteLength <= 1 + AES_IV_BYTES || p[0] !== SECRET_REGISTRY_ENVELOPE_VERSION) {
        throw vaultIncompatibleError('unsupported secret registry');
    }
    return {
        v: p[0],
        iv: p.subarray(1, 1 + AES_IV_BYTES),
        ct: p.subarray(1 + AES_IV_BYTES),
    };
}

function readSeedHeader(bytes) {
    const p = toBytes(bytes, 'packed bytes');
    const magicLen = p[0];
    const magic = decoder.decode(p.subarray(1, 1 + magicLen));
    const metaOffset = 1 + magicLen;
    const offset = metaOffset + 8;
    return {
        p,
        magic,
        metaOffset,
        offset,
        kdf: {
            name: VAULT_KDF.name,
            version: p[metaOffset + 7],
            m: new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(metaOffset + 3),
            t: p[metaOffset],
            p: p[metaOffset + 1],
            dkLen: p[metaOffset + 2],
        },
    };
}

export function detectSeedCrypto(bytes) {
    return readSeedHeader(bytes).magic;
}

export function seedDataHash(bytes) {
    return toHex(sha256(toBytes(bytes, 'vault bytes')));
}

// pack seed data for storing
export const packSeedData = ({ salt, iv, ciphertext, ct, registry, kdf = VAULT_KDF }) => {
    const body = ciphertext || ct;
    if (!salt || !iv || !body || !registry) {
        throw new Error('seed data missing');
    }

    const header = new Uint8Array(1 + SEED_MAGIC.length + 8);
    header[0] = SEED_MAGIC.length;
    header.set(SEED_MAGIC, 1);
    const offset = 1 + SEED_MAGIC.length;
    header[offset] = kdf.t;
    header[offset + 1] = kdf.p;
    header[offset + 2] = kdf.dkLen;
    new DataView(header.buffer).setUint32(offset + 3, kdf.m);
    header[offset + 7] = kdf.version;

    const bodyLength = new Uint8Array(SEED_CT_LENGTH_BYTES);
    new DataView(bodyLength.buffer).setUint32(0, toBytes(body, 'seed ciphertext').byteLength);

    return concatBytes(header, salt, iv, bodyLength, body, packRegistryData(registry));
};

// unpack seed data from storage
export const unpackSeedData = (bytes) => {
    const { p, magic, offset, kdf } = readSeedHeader(bytes);
    if (magic !== VAULT_CRYPTO) {
        throw vaultIncompatibleError('unsupported seed crypto');
    }

    const seedCtLengthOffset = offset + SALT_BYTES + AES_IV_BYTES;
    const seedCtLength = new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(seedCtLengthOffset);
    const ctOffset = seedCtLengthOffset + SEED_CT_LENGTH_BYTES;
    const registryOffset = ctOffset + seedCtLength;
    if (!seedCtLength || registryOffset >= p.byteLength) {
        throw vaultIncompatibleError('invalid seed data');
    }
    return {
        crypto: magic,
        kdf,
        salt: p.subarray(offset, offset + SALT_BYTES),
        iv: p.subarray(offset + SALT_BYTES, offset + SALT_BYTES + AES_IV_BYTES),
        ct: p.subarray(ctOffset, registryOffset),
        registry: unpackRegistryData(p.subarray(registryOffset)),
    };
};

export const unpackLegacyV2SeedData = (bytes) => {
    const { p, magic, offset, kdf } = readSeedHeader(bytes);
    if (magic !== LEGACY_V2_VAULT_CRYPTO) {
        throw vaultIncompatibleError('unsupported legacy seed crypto');
    }

    return {
        crypto: magic,
        kdf,
        salt: p.subarray(offset, offset + SALT_BYTES),
        iv: p.subarray(offset + SALT_BYTES, offset + SALT_BYTES + AES_IV_BYTES),
        ct: p.subarray(offset + SALT_BYTES + AES_IV_BYTES),
    };
};

export const packRawData = (...arrs) => concatBytes(...arrs);

export const packVersionedData = (version, nonce, ct) => {
    if (!Number.isInteger(version) || version < 0 || version > 255) {
        throw new Error('invalid data version');
    }
    return packRawData(new Uint8Array([version]), nonce, ct);
};

export const unpackVersionedData = (bytes, nonceBytes = BOX_NONCE_BYTES) => {
    const p = toBytes(bytes, 'packed bytes');
    if (p.byteLength <= 1 + nonceBytes) {
        throw new Error('invalid versioned data');
    }
    return {
        version: p[0],
        nonce: p.subarray(1, 1 + nonceBytes),
        ct: p.subarray(1 + nonceBytes),
    };
};

export const packBodyData = (nonce, ct) => packVersionedData(BODY_ENVELOPE_VERSION, nonce, ct);

export const unpackBodyData = (bytes, nonceBytes = BOX_NONCE_BYTES) => {
    const packed = unpackVersionedData(bytes, nonceBytes);
    if (packed.version !== BODY_ENVELOPE_VERSION) {
        throw new Error('unsupported body envelope');
    }
    return { nonce: packed.nonce, ct: packed.ct };
};
