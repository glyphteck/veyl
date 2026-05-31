import { WALLET_TRANSFER_PAGE_LIMIT } from '../config.js';
import { nonNegativeNumber } from '../utils/number.js';
import { cleanText } from '../utils/text.js';
import { walletPKtoSparkAddress } from '../wallet/spark.js';
import { isCompletedTransfer, txCreatedMs } from '../wallet/tx.js';

function balanceValue(result, fallback = null) {
    const raw = result?.satsBalance?.available ?? result?.balance ?? fallback;
    return typeof raw === 'bigint' ? Number(raw) : raw;
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

    const nextTransferId = cleanText(transferId);
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
        const { transfers = [] } = await wallet.getTransfers(WALLET_TRANSFER_PAGE_LIMIT, 0).catch(() => ({}));
        const list = Array.isArray(transfers) ? transfers : [];
        return list.find((t) => t?.id === nextTransferId) ?? null;
    }

    return null;
}

export function isMirrorableBotTransfer(tx, walletPK, resumeAtMs = 0) {
    if (!tx?.id || !isCompletedTransfer(tx)) {
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

    return txCreatedMs(tx) >= nonNegativeNumber(resumeAtMs, 0);
}

export async function mirrorBotTransfer(wallet, receiverWalletPK, amountSats, network) {
    const receiverSparkAddress = walletPKtoSparkAddress(receiverWalletPK, network);
    const tx = await wallet.transfer({
        receiverSparkAddress,
        amountSats: Number.parseInt(String(amountSats), 10),
    });

    return tx?.id || null;
}
