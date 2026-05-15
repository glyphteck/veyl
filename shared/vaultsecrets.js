import { unpackSeedData } from './crypto/pack.js';
import { decryptSeed, deriveWalletMnemonic } from './crypto/seed.js';
import { normalizePassword } from './password.js';

export function zeroBytes(bytes) {
    try {
        bytes?.fill?.(0);
    } catch {}
}

export async function decryptMasterSeed(encSeed, password, options = {}) {
    const nextPassword = normalizePassword(password);
    if (!nextPassword) {
        throw new Error('password required');
    }
    if (!encSeed) {
        throw new Error('vault not ready');
    }

    const { salt, iv, ct, kdf } = unpackSeedData(encSeed);
    return decryptSeed(ct, salt, iv, nextPassword, kdf, options);
}

export async function decryptWalletMnemonic(encSeed, password, options = {}) {
    const masterSeed = await decryptMasterSeed(encSeed, password, options);

    try {
        return deriveWalletMnemonic(masterSeed);
    } finally {
        zeroBytes(masterSeed);
    }
}

export async function verifyVaultPassword(encSeed, password, options = {}) {
    const masterSeed = await decryptMasterSeed(encSeed, password, options);
    try {
        return masterSeed.length === 32;
    } finally {
        zeroBytes(masterSeed);
    }
}
