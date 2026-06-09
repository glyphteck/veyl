import { LEGACY_V2_VAULT_CRYPTO, packSeedData, seedDataHash, unpackLegacyV2SeedData, unpackSeedData } from '@veyl/shared/crypto/pack';
import { createSecretRegistry, decryptSeed as decryptSeedShared, deriveLegacyWalletEntropy, deriveSeed, encryptSeed as encryptSeedShared, getDefaultWalletEntropy, mnemonicFromWalletEntropy, openSecretRegistry } from '@veyl/shared/crypto/seed';
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
    const nextPassword = normalizePassword(password);
    if (!nextPassword) {
        throw new Error('password required');
    }
    if (!vault) {
        throw new Error('vault not ready');
    }

    const { salt, iv, ct, kdf, registry } = unpackSeedData(vault);
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

export async function migrateLegacyV2Vault(vault, password) {
    const nextPassword = normalizePassword(password);
    if (!nextPassword) {
        throw new Error('password required');
    }
    if (!vault) {
        throw new Error('vault not ready');
    }

    const { salt, iv, ct, kdf } = unpackLegacyV2SeedData(vault);
    const masterSeed = await decryptSeed(ct, salt, iv, nextPassword, kdf);
    let walletEntropy = null;
    let chatSeed = null;
    try {
        walletEntropy = deriveLegacyWalletEntropy(masterSeed);
        chatSeed = deriveSeed(masterSeed, 'chat');
        const seedData = await encryptSeedShared(nextPassword, {
            deriveKey: deriveVaultKey,
            registry: createSecretRegistry({ walletEntropy, chatSeed }),
        });
        return {
            vault: packSeedData(seedData),
            expectedHash: seedDataHash(vault),
            from: LEGACY_V2_VAULT_CRYPTO,
            to: seedData.crypto,
            walletEntropy: new Uint8Array(walletEntropy),
            chatSeed: new Uint8Array(chatSeed),
        };
    } finally {
        zero(masterSeed);
        zero(walletEntropy);
        zero(chatSeed);
    }
}
