import { unpackSeedData } from '@veyl/shared/crypto/pack';
import { decryptSeed as decryptSeedShared, deriveWalletMnemonic as deriveWalletMnemonicShared, encryptSeed as encryptSeedShared } from '@veyl/shared/crypto/seed';
import { normalizePassword } from '@veyl/shared/password';
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

export async function decryptMasterSeed(vault, password) {
    const nextPassword = normalizePassword(password);
    if (!nextPassword) {
        throw new Error('password required');
    }
    if (!vault) {
        throw new Error('vault not ready');
    }

    const { salt, iv, ct, kdf } = unpackSeedData(vault);
    return decryptSeed(ct, salt, iv, nextPassword, kdf);
}

export async function decryptWalletMnemonic(vault, password) {
    const masterSeed = await decryptMasterSeed(vault, password);
    try {
        return deriveWalletMnemonicShared(masterSeed);
    } finally {
        zero(masterSeed);
    }
}

export async function verifyVaultPassword(vault, password) {
    const masterSeed = await decryptMasterSeed(vault, password);
    try {
        return masterSeed.length === 32;
    } finally {
        zero(masterSeed);
    }
}
