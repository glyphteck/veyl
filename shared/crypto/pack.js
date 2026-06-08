import { AES_IV_BYTES } from './aes.js';
import { BOX_NONCE_BYTES } from './box.js';
import { decoder, encoder, SALT_BYTES, toBytes } from './core.js';
import { VAULT_CRYPTO, VAULT_KDF } from './seed.js';

const SEED_MAGIC = encoder.encode(VAULT_CRYPTO);
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

// pack seed data for storing
export const packSeedData = ({ salt, iv, ciphertext, ct, kdf = VAULT_KDF }) => {
    const body = ciphertext || ct;
    if (!salt || !iv || !body) {
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

    return concatBytes(header, salt, iv, body);
};

// unpack seed data from storage
export const unpackSeedData = (bytes) => {
    const p = toBytes(bytes, 'packed bytes');
    const magicLen = p[0];
    const magic = decoder.decode(p.subarray(1, 1 + magicLen));
    if (magic !== VAULT_CRYPTO) {
        throw new Error('unsupported seed crypto');
    }

    const metaOffset = 1 + magicLen;
    const offset = metaOffset + 8;
    return {
        crypto: magic,
        kdf: {
            name: VAULT_KDF.name,
            version: p[metaOffset + 7],
            m: new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(metaOffset + 3),
            t: p[metaOffset],
            p: p[metaOffset + 1],
            dkLen: p[metaOffset + 2],
        },
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
