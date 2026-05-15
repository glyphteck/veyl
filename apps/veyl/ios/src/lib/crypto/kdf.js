import argon2 from 'react-native-argon2';
import { toHex } from '@glyphteck/shared/crypto/core';

function fromHex(hex) {
    if (typeof hex !== 'string' || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
        throw new Error('invalid argon2 hash');
    }
    return new Uint8Array(hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
}

export async function deriveVaultKey(password, salt, params) {
    const result = await argon2(password, toHex(salt), {
        iterations: params.t,
        memory: params.m,
        parallelism: params.p,
        hashLength: params.dkLen,
        mode: 'argon2id',
        saltEncoding: 'hex',
    });
    return fromHex(result.rawHash);
}
