'use client';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { sealAes, openAes } from './aes.js';
import { encoder, SALT_BYTES, randomBytes } from './core.js';

const VAULT_SALT = sha256(encoder.encode('vault-v1'));
const WALLET_MNEMONIC_ENTROPY_BYTES = 16;

export const VAULT_CRYPTO = 'crypto_glyphseal_v2';
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

// generate a new random seed
export function generateSeed() {
    return randomBytes(32);
}

// encrypt a given seed with password
// Note: caller responsible for zeroing seed after use if needed
export async function encryptSeedWithPassword(seed, pwd, options = {}) {
    const salt = randomBytes(SALT_BYTES);
    const params = normalizeVaultKdf(options.params);
    const deriveKey = getVaultDeriveKey(options);
    const key = await deriveKey(pwd, salt, params);
    const { iv, ct } = await sealAes(key, seed);
    key.fill(0);
    return { crypto: VAULT_CRYPTO, kdf: params, ciphertext: ct, salt, iv };
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
    const seed = await openAes(key, iv, ciphertext);
    key.fill(0);
    return seed;
}

// get feature specific seeds
export function deriveSeed(seed, label) {
    return hkdf(sha256, seed, VAULT_SALT, encoder.encode(label), 32);
}

export function deriveWalletMnemonic(seed) {
    const entropy = deriveSeed(seed, 'wallet-mnemonic');
    try {
        return entropyToMnemonic(entropy.subarray(0, WALLET_MNEMONIC_ENTROPY_BYTES), wordlist);
    } finally {
        entropy.fill(0);
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
