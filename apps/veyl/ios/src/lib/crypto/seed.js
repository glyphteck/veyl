import { unpackSeedData } from '@glyphteck/shared/crypto/pack';
import { decryptSeed as decryptSeedShared, deriveWalletMnemonic as deriveWalletMnemonicShared, encryptSeed as encryptSeedShared } from '@glyphteck/shared/crypto/seed';
import { normalizePassword } from '@glyphteck/shared/password';
import { deriveVaultKey } from './kdf';

function zero(bytes) {
    try {
        bytes?.fill?.(0);
    } catch {}
}

export const zeroBytes = zero;

export function encryptSeed(password) {
    return encryptSeedShared(password, { deriveKey: deriveVaultKey });
}

export function decryptSeed(ciphertext, salt, iv, password, kdf) {
    return decryptSeedShared(ciphertext, salt, iv, password, kdf, { deriveKey: deriveVaultKey });
}

export async function decryptMasterSeed(encSeed, password) {
    const nextPassword = normalizePassword(password);
    if (!nextPassword) {
        throw new Error('password required');
    }
    if (!encSeed) {
        throw new Error('vault not ready');
    }

    const { salt, iv, ct, kdf } = unpackSeedData(encSeed);
    return decryptSeed(ct, salt, iv, nextPassword, kdf);
}

export async function decryptWalletMnemonic(encSeed, password) {
    const masterSeed = await decryptMasterSeed(encSeed, password);
    try {
        return deriveWalletMnemonicShared(masterSeed);
    } finally {
        zero(masterSeed);
    }
}

export async function verifyVaultPassword(encSeed, password) {
    const masterSeed = await decryptMasterSeed(encSeed, password);
    try {
        return masterSeed.length === 32;
    } finally {
        zero(masterSeed);
    }
}
