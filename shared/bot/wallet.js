import { walletPKtoSparkAddress } from '../wallet/spark.js';

function balanceValue(result, fallback = null) {
    const raw = result?.satsBalance?.available ?? result?.balance ?? fallback;
    return typeof raw === 'bigint' ? Number(raw) : raw;
}

function txCreatedMs(tx) {
    const value = tx?.createdTime;
    if (value instanceof Date) {
        return value.getTime();
    }
    const ms = new Date(value ?? 0).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

export async function getBotBalance(wallet, { fallback = null } = {}) {
    if (!wallet) {
        return fallback;
    }
    const raw = await wallet.getBalance();
    return balanceValue(raw, fallback);
}

export async function getBotTransfer(wallet, transferId) {
    if (!wallet) {
        return null;
    }

    const nextTransferId = String(transferId ?? '').trim();
    if (!nextTransferId) {
        return null;
    }

    if (typeof wallet.getTransfer === 'function') {
        const direct = await wallet.getTransfer(nextTransferId).catch(() => null);
        if (direct) {
            return direct;
        }
    }

    if (typeof wallet.getTransfers === 'function') {
        const { transfers = [] } = await wallet.getTransfers(100, 0).catch(() => ({}));
        const list = Array.isArray(transfers) ? transfers : [];
        return list.find((t) => t?.id === nextTransferId) ?? null;
    }

    return null;
}

export function isMirrorableBotTransfer(tx, walletPK, resumeAtMs = 0) {
    if (!tx?.id || tx?.status !== 'TRANSFER_STATUS_COMPLETED') {
        return false;
    }
    if (tx?.transferDirection !== 'INCOMING') {
        return false;
    }
    if (!tx?.senderIdentityPublicKey || tx.senderIdentityPublicKey === walletPK) {
        return false;
    }
    if (tx?.senderIdentityPublicKey === tx?.receiverIdentityPublicKey) {
        return false;
    }
    if (tx?.type === 'BITCOIN_DEPOSIT' || tx?.type === 'COOPERATIVE_EXIT') {
        return false;
    }
    if (tx?.type === 'UTXO_SWAP') {
        return false;
    }

    const amount = Number(tx?.totalValue ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        return false;
    }

    return txCreatedMs(tx) >= Math.max(0, Number(resumeAtMs) || 0);
}

export async function mirrorBotTransfer(wallet, receiverWalletPK, amountSats, network) {
    const receiverSparkAddress = walletPKtoSparkAddress(receiverWalletPK, network);
    const tx = await wallet.transfer({
        receiverSparkAddress,
        amountSats: Number.parseInt(String(amountSats), 10),
    });

    return tx?.id || null;
}
