import { timestampMs } from '../utils/time.js';
import { sameText } from '../utils/text.js';

export const TRANSFER_STATUS_COMPLETED = 'TRANSFER_STATUS_COMPLETED';
export const TRANSFER_TYPE_BITCOIN_DEPOSIT = 'BITCOIN_DEPOSIT';
export const TRANSFER_TYPE_COOPERATIVE_EXIT = 'COOPERATIVE_EXIT';
export const TRANSFER_TYPE_TRANSFER = 'TRANSFER';
export const TRANSFER_TYPE_UTXO_SWAP = 'UTXO_SWAP';
export const CLAIMABLE_TRANSFER_STATUS_CODES = new Set([2, 3, 4, 9, 10]);
export const CLAIMABLE_TRANSFER_STATUSES = new Set([
    'TRANSFER_STATUS_SENDER_KEY_TWEAKED',
    'TRANSFER_STATUS_RECEIVER_KEY_TWEAKED',
    'TRANSFER_STATUS_RECEIVER_REFUND_SIGNED',
    'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_LOCKED',
    'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_APPLIED',
]);
const TRANSFER_TYPE_COOPERATIVE_EXIT_CODE = 1;
const TRANSFER_TYPE_TRANSFER_CODE = 2;
const TRANSFER_TYPE_UTXO_SWAP_CODE = 3;
const FINAL_TRANSFER_STATUS_CODES = new Set([5, 6, 7, -1]);
const FINAL_TRANSFER_STATUSES = new Set([TRANSFER_STATUS_COMPLETED, 'TRANSFER_STATUS_EXPIRED', 'TRANSFER_STATUS_RETURNED', 'UNRECOGNIZED']);
const HIDDEN_TRANSFER_STATUS_CODES = new Set([6, 7, -1]);
const HIDDEN_TRANSFER_STATUSES = new Set(['TRANSFER_STATUS_EXPIRED', 'TRANSFER_STATUS_RETURNED', 'UNRECOGNIZED']);
const LIGHTNING_RECEIVE_DONE_STATUSES = new Set(['transfer_completed', 'lightning_payment_received', 'payment_preimage_recovered', 'completed']);
const WALLET_TRANSFER_TYPE_CODES = new Set([TRANSFER_TYPE_TRANSFER_CODE]);
const WALLET_TRANSFER_TYPES = new Set([TRANSFER_TYPE_TRANSFER]);
const WITHDRAWAL_TRANSFER_TYPE_CODES = new Set([TRANSFER_TYPE_COOPERATIVE_EXIT_CODE]);
const WITHDRAWAL_TRANSFER_TYPES = new Set([TRANSFER_TYPE_COOPERATIVE_EXIT]);
const BITCOIN_DEPOSIT_TYPE_CODES = new Set();
const BITCOIN_DEPOSIT_TYPES = new Set([TRANSFER_TYPE_BITCOIN_DEPOSIT]);
const FUNDING_TRANSFER_TYPE_CODES = new Set([TRANSFER_TYPE_UTXO_SWAP_CODE]);
const FUNDING_TRANSFER_TYPES = new Set([TRANSFER_TYPE_BITCOIN_DEPOSIT, TRANSFER_TYPE_UTXO_SWAP]);

function hasTransferType(tx, names, codes) {
    const type = tx?.type;
    if (typeof type === 'string') {
        return names.has(type);
    }
    return Number.isFinite(type) && codes.has(type);
}

function isIncomingTransfer(tx) {
    return sameText(tx?.transferDirection, 'INCOMING');
}

export function txCreatedMs(tx) {
    return timestampMs(tx?.createdTime, null, { parseString: true }) ?? timestampMs(tx?.updatedTime, 0, { parseString: true });
}

export function txUpdatedMs(tx) {
    return timestampMs(tx?.updatedTime, 0, { parseString: true });
}

export function isCompletedTransfer(tx) {
    return tx?.status === TRANSFER_STATUS_COMPLETED;
}

export function isIncomingCompletedTransfer(tx) {
    return isCompletedTransfer(tx) && isIncomingTransfer(tx);
}

export function isReceivePaymentTransfer(tx, { createdAt, amountSats, skewMs = 0 } = {}) {
    if (!isIncomingCompletedTransfer(tx)) {
        return false;
    }

    const invoiceMs = timestampMs(createdAt, null, { parseString: true });
    const transferMs = txCreatedMs(tx);
    if (Number.isFinite(invoiceMs) && Number.isFinite(transferMs) && transferMs < invoiceMs - skewMs) {
        return false;
    }

    const expectedAmount = Number(amountSats);
    if (Number.isSafeInteger(expectedAmount) && expectedAmount > 0) {
        return Number(tx?.totalValue) === expectedAmount;
    }

    return true;
}

export function isLightningReceiveDone(status) {
    return LIGHTNING_RECEIVE_DONE_STATUSES.has(typeof status === 'string' ? status.trim().toLowerCase() : '');
}

export function isPendingTransfer(tx) {
    const status = tx?.status;
    if (Number.isFinite(status)) {
        return !FINAL_TRANSFER_STATUS_CODES.has(status);
    }
    return typeof status === 'string' && !!status && !FINAL_TRANSFER_STATUSES.has(status);
}

export function isWalletTransfer(tx) {
    return hasTransferType(tx, WALLET_TRANSFER_TYPES, WALLET_TRANSFER_TYPE_CODES);
}

export function isWithdrawalTransfer(tx) {
    return hasTransferType(tx, WITHDRAWAL_TRANSFER_TYPES, WITHDRAWAL_TRANSFER_TYPE_CODES);
}

export function isFundingTransfer(tx) {
    if (hasTransferType(tx, BITCOIN_DEPOSIT_TYPES, BITCOIN_DEPOSIT_TYPE_CODES)) {
        return true;
    }
    return hasTransferType(tx, FUNDING_TRANSFER_TYPES, FUNDING_TRANSFER_TYPE_CODES) && isIncomingTransfer(tx);
}

export function isVisibleTransferStatus(tx) {
    const status = tx?.status;
    if (Number.isFinite(status)) {
        return !HIDDEN_TRANSFER_STATUS_CODES.has(status);
    }
    return !status || !HIDDEN_TRANSFER_STATUSES.has(status);
}

export function isVisibleTransfer(tx) {
    return isVisibleTransferStatus(tx) && (isWalletTransfer(tx) || isFundingTransfer(tx) || isWithdrawalTransfer(tx));
}

export function isClaimablePendingTransfer(tx, types = null) {
    if (Array.isArray(types) && types.length && !types.includes(tx?.type)) {
        return false;
    }
    return CLAIMABLE_TRANSFER_STATUSES.has(tx?.status) || CLAIMABLE_TRANSFER_STATUS_CODES.has(tx?.status);
}

export function transferBelongsToWallet(tx, walletPK) {
    return !!walletPK && (sameText(tx?.senderIdentityPublicKey, walletPK) || sameText(tx?.receiverIdentityPublicKey, walletPK));
}
