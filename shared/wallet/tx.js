import { timestampMs } from '../utils/time.js';
import { sameText } from '../utils/text.js';

export const TRANSFER_STATUS_COMPLETED = 'TRANSFER_STATUS_COMPLETED';
export const CLAIMABLE_TRANSFER_STATUS_CODES = new Set([2, 3, 4, 9, 10]);
export const CLAIMABLE_TRANSFER_STATUSES = new Set([
    'TRANSFER_STATUS_SENDER_KEY_TWEAKED',
    'TRANSFER_STATUS_RECEIVER_KEY_TWEAKED',
    'TRANSFER_STATUS_RECEIVER_REFUND_SIGNED',
    'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_LOCKED',
    'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_APPLIED',
]);
const FINAL_TRANSFER_STATUS_CODES = new Set([5, 6, 7, -1]);
const FINAL_TRANSFER_STATUSES = new Set([TRANSFER_STATUS_COMPLETED, 'TRANSFER_STATUS_EXPIRED', 'TRANSFER_STATUS_RETURNED', 'UNRECOGNIZED']);
const HIDDEN_TRANSFER_STATUS_CODES = new Set([6, 7, -1]);
const HIDDEN_TRANSFER_STATUSES = new Set(['TRANSFER_STATUS_EXPIRED', 'TRANSFER_STATUS_RETURNED', 'UNRECOGNIZED']);

export function txCreatedMs(tx) {
    return timestampMs(tx?.createdTime, null, { parseString: true }) ?? timestampMs(tx?.updatedTime, 0, { parseString: true });
}

export function txUpdatedMs(tx) {
    return timestampMs(tx?.updatedTime, 0, { parseString: true });
}

export function isCompletedTransfer(tx) {
    return tx?.status === TRANSFER_STATUS_COMPLETED;
}

export function isPendingTransfer(tx) {
    const status = tx?.status;
    if (Number.isFinite(status)) {
        return !FINAL_TRANSFER_STATUS_CODES.has(status);
    }
    return typeof status === 'string' && !!status && !FINAL_TRANSFER_STATUSES.has(status);
}

export function isVisibleTransfer(tx) {
    const status = tx?.status;
    if (Number.isFinite(status)) {
        return !HIDDEN_TRANSFER_STATUS_CODES.has(status);
    }
    return !status || !HIDDEN_TRANSFER_STATUSES.has(status);
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
