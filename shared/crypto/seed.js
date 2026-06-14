'use client';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { sealAes, openAes } from './aes.js';
import { cleanBytes, decoder, encoder, fromHex, fromHexBytes, randomBytes, SALT_BYTES, toBytes, toHex } from './core.js';

const VAULT_SALT = sha256(encoder.encode('vault-v1'));
const WALLET_MNEMONIC_ENTROPY_BYTES = 16;
const SECRET_REGISTRY_AAD = encoder.encode('secret-registry-v1');
const ENTROPY_HEX_RE = /^[0-9a-f]{32}$/;
const SEED_HEX_RE = /^[0-9a-f]{64}$/;
const DEFAULT_WALLET_ID = 'main';
const DEFAULT_WALLET_KIND = 'bip39-entropy-v1';

export const VAULT_CRYPTO = 'crypto_glyphseal_v3';
export const VAULT_INCOMPATIBLE_ERROR = 'vault/incompatible';
export const SECRET_REGISTRY_VERSION = 1;
export const SECRET_REGISTRY_ENVELOPE_VERSION = 1;
export const VAULT_KDF = {
    name: 'argon2id',
    version: 0x13,
    m: 64 * 1024,
    t: 3,
    p: 1,
    dkLen: 32,
};

export function normalizeVaultKdf(params = {}) {
    const next = { ...VAULT_KDF, ...(params || {}) };
    if (next.name !== 'argon2id') {
        throw new Error('unsupported vault kdf');
    }
    return next;
}

function getVaultDeriveKey(options = {}) {
    if (typeof options.deriveKey !== 'function') {
        throw new Error('vault kdf implementation required');
    }
    return options.deriveKey;
}

export function vaultIncompatibleError(message = 'vault reset required') {
    const error = new Error(message);
    error.code = VAULT_INCOMPATIBLE_ERROR;
    return error;
}

export function isVaultIncompatibleError(error) {
    return error?.code === VAULT_INCOMPATIBLE_ERROR;
}

// generate a new random seed
export function generateSeed() {
    return randomBytes(32);
}

function nowMs(value) {
    return Number.isFinite(value) && value > 0 ? value : Date.now();
}

function cleanId(value, fallback) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(text) ? text : fallback;
}

function randomSeedHex() {
    const seed = generateSeed();
    try {
        return toHex(seed);
    } finally {
        cleanBytes(seed);
    }
}

function randomEntropyHex() {
    const entropy = randomBytes(WALLET_MNEMONIC_ENTROPY_BYTES);
    try {
        return toHex(entropy);
    } finally {
        cleanBytes(entropy);
    }
}

function entropyHexFromOption(value) {
    if (value == null) {
        return randomEntropyHex();
    }
    const bytes = toBytes(value, 'wallet entropy');
    if (bytes.length !== WALLET_MNEMONIC_ENTROPY_BYTES) {
        throw new Error('wallet entropy required');
    }
    return cleanEntropyHex(toHex(bytes), 'wallet');
}

function cleanEntropyHex(value, label) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!ENTROPY_HEX_RE.test(text)) {
        throw new Error(`${label} entropy required`);
    }
    return text;
}

function entropyBytes(value, label) {
    return fromHexBytes(cleanEntropyHex(value, label), label);
}

function cleanSeedHex(value, label) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!SEED_HEX_RE.test(text)) {
        throw new Error(`${label} seed required`);
    }
    return text;
}

function seedBytes(value, label) {
    return fromHex(cleanSeedHex(value, label), label);
}

function seedHexFromOption(value, label) {
    if (value == null) {
        return randomSeedHex();
    }
    const bytes = toBytes(value, `${label} seed`);
    if (bytes.length !== 32) {
        throw new Error(`${label} seed required`);
    }
    return cleanSeedHex(toHex(bytes), label);
}

function normalizeWallets(wallets, defaultWalletId) {
    const input = wallets && typeof wallets === 'object' && !Array.isArray(wallets) ? wallets : {};
    const out = {};
    for (const [rawId, wallet] of Object.entries(input)) {
        const id = cleanId(wallet?.id || rawId, '');
        if (!id) {
            continue;
        }
        const kind = typeof wallet?.kind === 'string' && wallet.kind.trim() ? wallet.kind.trim().toLowerCase() : DEFAULT_WALLET_KIND;
        if (kind !== DEFAULT_WALLET_KIND) {
            throw new Error(`unsupported wallet ${id} secret`);
        }
        out[id] = {
            id,
            v: SECRET_REGISTRY_VERSION,
            kind,
            entropy: cleanEntropyHex(wallet?.entropy, `wallet ${id}`),
            status: wallet?.status === 'archived' ? 'archived' : 'active',
            createdAt: nowMs(wallet?.createdAt),
        };
    }

    if (!out[defaultWalletId]) {
        throw new Error('default wallet missing');
    }
    return out;
}

export function createSecretRegistry(options = {}) {
    const createdAt = nowMs(options.createdAt);
    return {
        v: SECRET_REGISTRY_VERSION,
        defaultWalletId: DEFAULT_WALLET_ID,
        wallets: {
            [DEFAULT_WALLET_ID]: {
                id: DEFAULT_WALLET_ID,
                v: SECRET_REGISTRY_VERSION,
                kind: DEFAULT_WALLET_KIND,
                entropy: entropyHexFromOption(options.walletEntropy),
                status: 'active',
                createdAt,
            },
        },
        chat: {
            id: 'primary',
            v: SECRET_REGISTRY_VERSION,
            seed: seedHexFromOption(options.chatSeed, 'chat'),
            status: 'active',
            createdAt,
        },
        cache: {
            v: SECRET_REGISTRY_VERSION,
            seed: seedHexFromOption(options.cacheSeed, 'cache'),
            createdAt,
        },
    };
}

export function normalizeSecretRegistry(registry) {
    if (!registry || typeof registry !== 'object' || Array.isArray(registry) || registry.v !== SECRET_REGISTRY_VERSION) {
        throw vaultIncompatibleError('unsupported secret registry');
    }

    const defaultWalletId = cleanId(registry.defaultWalletId, DEFAULT_WALLET_ID);
    return {
        v: SECRET_REGISTRY_VERSION,
        defaultWalletId,
        wallets: normalizeWallets(registry.wallets, defaultWalletId),
        chat: {
            id: cleanId(registry.chat?.id, 'primary'),
            v: SECRET_REGISTRY_VERSION,
            seed: cleanSeedHex(registry.chat?.seed, 'chat'),
            status: registry.chat?.status === 'archived' ? 'archived' : 'active',
            createdAt: nowMs(registry.chat?.createdAt),
        },
        cache: {
            v: SECRET_REGISTRY_VERSION,
            seed: cleanSeedHex(registry.cache?.seed, 'cache'),
            createdAt: nowMs(registry.cache?.createdAt),
        },
    };
}

function secretRegistryKey(masterSeed) {
    return deriveSeed(masterSeed, 'secret-registry-wrap-v1');
}

export async function sealSecretRegistry(masterSeed, registry) {
    const key = secretRegistryKey(masterSeed);
    let body = null;
    try {
        body = encoder.encode(JSON.stringify(normalizeSecretRegistry(registry)));
        const { iv, ct } = await sealAes(key, body, SECRET_REGISTRY_AAD);
        return {
            v: SECRET_REGISTRY_ENVELOPE_VERSION,
            iv,
            ct,
        };
    } finally {
        cleanBytes(body);
        cleanBytes(key);
    }
}

export async function openSecretRegistry(masterSeed, envelope) {
    if (envelope?.v !== SECRET_REGISTRY_ENVELOPE_VERSION || !envelope?.iv || !envelope?.ct) {
        throw vaultIncompatibleError('secret registry required');
    }
    const key = secretRegistryKey(masterSeed);
    let body = null;
    try {
        body = await openAes(key, envelope.iv, envelope.ct, SECRET_REGISTRY_AAD);
        return normalizeSecretRegistry(JSON.parse(decoder.decode(body)));
    } finally {
        cleanBytes(body);
        cleanBytes(key);
    }
}

export function getDefaultWalletEntropy(registry) {
    const secrets = normalizeSecretRegistry(registry);
    const wallet = secrets.wallets[secrets.defaultWalletId];
    if (!wallet || wallet.status !== 'active') {
        throw new Error('active wallet entropy required');
    }
    return entropyBytes(wallet.entropy, `wallet ${wallet.id}`);
}

export function getChatSeed(registry) {
    const secrets = normalizeSecretRegistry(registry);
    if (secrets.chat.status !== 'active') {
        throw new Error('active chat seed required');
    }
    return seedBytes(secrets.chat.seed, 'chat');
}

export function getCacheSeed(registry) {
    const secrets = normalizeSecretRegistry(registry);
    return seedBytes(secrets.cache.seed, 'cache');
}

export function deriveDeviceCacheKey(cacheSeed, deviceSecret, uid = '', network = '') {
    const cacheBytes = toBytes(cacheSeed, 'cache seed');
    const deviceBytes = toBytes(deviceSecret, 'device cache secret');
    if (cacheBytes.length !== 32 || deviceBytes.length !== 32) {
        throw new Error('cache key material required');
    }

    const input = new Uint8Array(64);
    input.set(cacheBytes, 0);
    input.set(deviceBytes, 32);
    try {
        return hkdf(sha256, input, VAULT_SALT, encoder.encode(JSON.stringify(['local-cache-device-v1', String(uid || ''), String(network || '')])), 32);
    } finally {
        cleanBytes(input);
    }
}

// encrypt a given seed with password
// Note: caller responsible for zeroing seed after use if needed
export async function encryptSeedWithPassword(seed, pwd, options = {}) {
    const salt = randomBytes(SALT_BYTES);
    const params = normalizeVaultKdf(options.params);
    const deriveKey = getVaultDeriveKey(options);
    const registry = normalizeSecretRegistry(options.registry || createSecretRegistry());
    const sealedRegistry = await sealSecretRegistry(seed, registry);
    const key = await deriveKey(pwd, salt, params);
    try {
        const { iv, ct } = await sealAes(key, seed);
        return { crypto: options.crypto || VAULT_CRYPTO, kdf: params, ciphertext: ct, salt, iv, registry: sealedRegistry };
    } finally {
        key.fill(0);
    }
}

export async function encryptSeed(pwd, options = {}) {
    const seed = generateSeed();
    const result = await encryptSeedWithPassword(seed, pwd, options);
    seed.fill(0); // Zero sensitive buffer
    return result;
}

// decrypt master seed with password
// Note: caller responsible for zeroing returned seed when no longer needed
export async function decryptSeed(ciphertext, salt, iv, pwd, params = VAULT_KDF, options = {}) {
    const kdf = normalizeVaultKdf(params);
    const deriveKey = getVaultDeriveKey(options);
    const key = await deriveKey(pwd, salt, kdf);
    try {
        return await openAes(key, iv, ciphertext);
    } finally {
        key.fill(0);
    }
}

// get feature specific seeds
export function deriveSeed(seed, label) {
    return hkdf(sha256, seed, VAULT_SALT, encoder.encode(label), 32);
}

export function mnemonicFromWalletEntropy(entropy) {
    const entropyBytesValue = toBytes(entropy, 'wallet entropy');
    if (entropyBytesValue.length !== WALLET_MNEMONIC_ENTROPY_BYTES) {
        throw new Error('wallet entropy required');
    }
    return entropyToMnemonic(entropyBytesValue, wordlist);
}

export function deriveLegacyWalletEntropy(seed) {
    const entropy = deriveSeed(seed, 'wallet-mnemonic');
    const out = new Uint8Array(entropy.subarray(0, WALLET_MNEMONIC_ENTROPY_BYTES));
    cleanBytes(entropy);
    return out;
}

export function deriveWalletMnemonic(seed) {
    const entropy = deriveLegacyWalletEntropy(seed);
    try {
        return mnemonicFromWalletEntropy(entropy);
    } finally {
        cleanBytes(entropy);
    }
}

// get key pair for chat
export function getKeyPair(seed) {
    const priv = new Uint8Array(seed);
    priv[0] &= 248;
    priv[31] &= 127;
    priv[31] |= 64;
    const pub = x25519.getPublicKey(priv);
    return { priv, pub };
}
