import { unpackSeedData } from '@veyl/shared/crypto/pack';
import { decryptSeed as decryptSeedShared, encryptSeed as encryptSeedShared, getDefaultWalletEntropy, mnemonicFromWalletEntropy, openSecretRegistry } from '@veyl/shared/crypto/seed';
import { migrateVault as migrateVaultShared, shouldMigrateVault as shouldMigrateVaultShared } from '@veyl/shared/crypto/vaultmigration';
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

export function unpackVaultSeedData(vault) {
    return unpackSeedData(vault);
}

export async function decryptMasterSeed(vault, password) {
    const nextPassword = normalizePassword(password);
    if (!nextPassword) {
        throw new Error('password required');
    }
    if (!vault) {
        throw new Error('vault not ready');
    }

    const { salt, iv, ct, kdf } = unpackVaultSeedData(vault);
    return decryptSeed(ct, salt, iv, nextPassword, kdf);
}

export async function decryptWalletMnemonic(vault, password) {
    const nextPassword = normalizePassword(password);
    if (!nextPassword) {
        throw new Error('password required');
    }
    if (!vault) {
        throw new Error('vault not ready');
    }

    const { salt, iv, ct, kdf, registry } = unpackVaultSeedData(vault);
    const masterSeed = await decryptSeed(ct, salt, iv, nextPassword, kdf);
    let walletEntropy = null;
    try {
        walletEntropy = getDefaultWalletEntropy(await openSecretRegistry(masterSeed, registry));
        return mnemonicFromWalletEntropy(walletEntropy);
    } finally {
        zero(walletEntropy);
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

export function shouldMigrateVault(vault) {
    return shouldMigrateVaultShared(vault);
}

export async function migrateVault(vault, password) {
    return migrateVaultShared(vault, password, { deriveKey: deriveVaultKey });
}
