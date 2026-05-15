import { Bytes } from 'firebase/firestore';
import { AES_IV_BYTES } from './aes.js';
import { BOX_NONCE_BYTES } from './box.js';
import { decoder, encoder, SALT_BYTES, toBytes } from './core.js';
import { VAULT_CRYPTO, VAULT_KDF } from './seed.js';

const SEED_MAGIC = encoder.encode(VAULT_CRYPTO);

const concat = (...arrs) => {
    let len = 0;
    for (const a of arrs) len += a.length;
    const out = new Uint8Array(len);
    let offset = 0;
    for (const a of arrs) {
        out.set(a, offset);
        offset += a.length;
    }
    return out;
};

function toPackedBytes(bytes) {
    if (typeof bytes?.toUint8Array === 'function') {
        return bytes.toUint8Array();
    }
    return toBytes(bytes, 'packed bytes');
}

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

    return Bytes.fromUint8Array(concat(header, salt, iv, body));
};

// unpack seed data from storage
export const unpackSeedData = (bytes) => {
    const p = toPackedBytes(bytes);
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

export const packRawData = (nonce, ct) => concat(nonce, ct);

export const packBodyData = (nonce, ct) => Bytes.fromUint8Array(packRawData(nonce, ct));

export const unpackBodyData = (bytes, nonceBytes = BOX_NONCE_BYTES) => {
    const p = toPackedBytes(bytes);
    return { nonce: p.subarray(0, nonceBytes), ct: p.subarray(nonceBytes) };
};
