import { detectSeedCrypto, packSeedData, seedDataHash, unpackSeedDataForCrypto } from './pack.js';
import { VAULT_CRYPTO, decryptSeed, encryptSeed, getChatSeed, getDefaultWalletEntropy, openSecretRegistry, vaultIncompatibleError } from './seed.js';
import { normalizePassword } from '../password.js';

export const VAULT_MIGRATIONS = Object.freeze([]);

function zero(bytes) {
    try {
        bytes?.fill?.(0);
    } catch {}
}

export function getVaultMigrationPlan(from, to, migrations = VAULT_MIGRATIONS) {
    if (!from || !to || from === to) {
        return [];
    }

    const bySource = new Map();
    for (const step of migrations || []) {
        if (!step?.from || !step?.to) continue;
        const list = bySource.get(step.from) || [];
        list.push(step);
        bySource.set(step.from, list);
    }

    const queue = [{ version: from, plan: [] }];
    const seen = new Set([from]);
    while (queue.length) {
        const item = queue.shift();
        for (const step of bySource.get(item.version) || []) {
            if (seen.has(step.to)) continue;
            const plan = [...item.plan, step];
            if (step.to === to) {
                return plan;
            }
            seen.add(step.to);
            queue.push({ version: step.to, plan });
        }
    }

    return null;
}

export function getVaultMigration(vault, { targetCrypto = VAULT_CRYPTO, migrations = VAULT_MIGRATIONS } = {}) {
    try {
        const from = detectSeedCrypto(vault);
        const plan = getVaultMigrationPlan(from, targetCrypto, migrations);
        return plan?.length ? { from, to: targetCrypto, plan } : null;
    } catch {
        return null;
    }
}

export function shouldMigrateVault(vault, options = {}) {
    return !!getVaultMigration(vault, options);
}

async function migrateSameLayoutRegistryVault(vault, password, step, options) {
    const { salt, iv, ct, kdf, registry: registryEnvelope } = unpackSeedDataForCrypto(vault, step.from);
    const masterSeed = await decryptSeed(ct, salt, iv, password, kdf, options);
    let walletEntropy = null;
    let chatSeed = null;
    try {
        const registry = await openSecretRegistry(masterSeed, registryEnvelope);
        walletEntropy = getDefaultWalletEntropy(registry);
        chatSeed = getChatSeed(registry);
        const seedData = await encryptSeed(password, {
            ...options,
            crypto: step.to,
            registry,
        });
        return {
            vault: packSeedData(seedData),
            walletEntropy: new Uint8Array(walletEntropy),
            chatSeed: new Uint8Array(chatSeed),
        };
    } finally {
        zero(masterSeed);
        zero(walletEntropy);
        zero(chatSeed);
    }
}

export async function migrateVault(vault, password, options = {}) {
    const nextPassword = normalizePassword(password);
    if (!nextPassword) {
        throw new Error('password required');
    }
    if (!vault) {
        throw new Error('vault not ready');
    }

    const targetCrypto = options.targetCrypto || VAULT_CRYPTO;
    const migration = getVaultMigration(vault, { targetCrypto, migrations: options.migrations });
    if (!migration) {
        throw vaultIncompatibleError('unsupported seed crypto');
    }

    let currentVault = vault;
    let walletEntropy = null;
    let chatSeed = null;
    try {
        for (const step of migration.plan) {
            if (step.kind !== 'same-layout-registry') {
                throw vaultIncompatibleError('unsupported vault migration');
            }
            zero(walletEntropy);
            zero(chatSeed);
            const result = await migrateSameLayoutRegistryVault(currentVault, nextPassword, step, options);
            currentVault = result.vault;
            walletEntropy = result.walletEntropy;
            chatSeed = result.chatSeed;
        }
        return {
            vault: currentVault,
            expectedHash: seedDataHash(vault),
            from: migration.from,
            to: migration.to,
            walletEntropy: new Uint8Array(walletEntropy),
            chatSeed: new Uint8Array(chatSeed),
        };
    } finally {
        zero(walletEntropy);
        zero(chatSeed);
    }
}
