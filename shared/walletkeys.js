'use client';

const VALID_WALLET_NETWORKS = new Set(['MAINNET', 'REGTEST', 'TESTNET', 'SIGNET', 'LOCAL']);

export function normalizeWalletNetwork(network) {
    const next = String(network ?? '').trim().toUpperCase();
    return VALID_WALLET_NETWORKS.has(next) ? next : 'REGTEST';
}

export function walletPKField(network) {
    return `walletPKs.${normalizeWalletNetwork(network)}`;
}

export function resolveWalletPK(data, network) {
    const key = normalizeWalletNetwork(network);
    const walletPKs = data?.walletPKs;
    const walletPK = walletPKs && typeof walletPKs === 'object' && typeof walletPKs[key] === 'string' ? walletPKs[key].trim() : '';
    if (walletPK) {
        return normalizeWalletPK(walletPK);
    }
    return null;
}

function normalizeWalletPK(walletPK) {
    return typeof walletPK === 'string' ? walletPK.trim().toLowerCase() : walletPK;
}

export function hasWalletPKForNetwork(data, network) {
    const key = normalizeWalletNetwork(network);
    const walletPKs = data?.walletPKs;
    return !!(walletPKs && typeof walletPKs === 'object' && typeof walletPKs[key] === 'string' && walletPKs[key].trim());
}

export function walletPKPatch(walletPK, network) {
    return {
        walletPKs: {
            [normalizeWalletNetwork(network)]: normalizeWalletPK(walletPK),
        },
    };
}
