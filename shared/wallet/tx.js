import { timestampMs } from '../utils/time.js';

export const TRANSFER_STATUS_COMPLETED = 'TRANSFER_STATUS_COMPLETED';
const FINAL_TRANSFER_STATUSES = new Set([TRANSFER_STATUS_COMPLETED, 'TRANSFER_STATUS_EXPIRED', 'TRANSFER_STATUS_RETURNED', 'UNRECOGNIZED']);
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
    const status = typeof tx?.status === 'string' ? tx.status : '';
    return !!status && !FINAL_TRANSFER_STATUSES.has(status);
}

export function isVisibleTransfer(tx) {
    return !tx?.status || !HIDDEN_TRANSFER_STATUSES.has(tx.status);
}
