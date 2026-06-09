'use client';

import { isPendingTransfer, transferBelongsToWallet, txCreatedMs } from '../../wallet/tx.js';
import { lowerText, sameText } from '../../utils/text.js';
import { jsonClean } from './schema.js';

function emptyTransferState(extra = {}) {
    return { transfers: [], historyComplete: false, nextOffset: 0, oldestTxMs: null, walletPK: null, rejectReason: null, ...extra };
}

export function readCachedTransferState(cache, { walletPK = null } = {}) {
    const payload = cache?.read?.();
    if (!payload?.transfersById) {
        return emptyTransferState({ rejectReason: 'missing-cache' });
    }
    const cachedWalletPK = lowerText(payload.transferWalletPK);
    const requestedWalletPK = lowerText(walletPK);
    if (!requestedWalletPK) {
        return emptyTransferState({ walletPK: cachedWalletPK, rejectReason: 'missing-wallet' });
    }
    if (requestedWalletPK && (!cachedWalletPK || !sameText(cachedWalletPK, requestedWalletPK))) {
        return emptyTransferState({ walletPK: cachedWalletPK, rejectReason: cachedWalletPK ? 'wallet-mismatch' : 'missing-cache-wallet' });
    }
    const ids = Array.isArray(payload.transferIds) && payload.transferIds.length ? payload.transferIds : Object.keys(payload.transfersById);
    const transfers = ids
        .map((id) => payload.transfersById[id])
        .filter(Boolean)
        .filter((tx) => !isPendingTransfer(tx))
        .sort((a, b) => txCreatedMs(b) - txCreatedMs(a));
    if (requestedWalletPK && transfers.some((tx) => !transferBelongsToWallet(tx, requestedWalletPK))) {
        return emptyTransferState({ walletPK: cachedWalletPK, rejectReason: 'non-owned-transfer' });
    }
    const cachedNextOffset = Number.isFinite(payload.transferNextOffset) ? payload.transferNextOffset : transfers.length;
    const nextOffset = Math.min(Math.max(0, cachedNextOffset), transfers.length);
    const oldestTxMs = Number.isFinite(payload.transferOldestMs) ? payload.transferOldestMs : null;
    return {
        transfers,
        historyComplete: payload.transferHistoryComplete === true,
        nextOffset,
        oldestTxMs,
        walletPK: cachedWalletPK || null,
    };
}

export function writeCachedTransferState(cache, { transfers, walletPK = null, historyComplete = false, nextOffset = null, oldestTxMs = null } = {}) {
    if (!cache?.patch) {
        return;
    }

    const nextWalletPK = lowerText(walletPK);
    if (nextWalletPK && !Array.isArray(transfers)) {
        return;
    }

    void cache.patch((payload) => {
        if (!nextWalletPK) {
            payload.transfersById = {};
            payload.transferIds = [];
            payload.transferWalletPK = null;
            payload.transferHistoryComplete = false;
            payload.transferNextOffset = 0;
            payload.transferOldestMs = null;
            return payload;
        }
        const previousWalletPK = lowerText(payload.transferWalletPK);
        const walletChanged = !!(nextWalletPK && previousWalletPK && !sameText(nextWalletPK, previousWalletPK));
        const byId = {};
        const ids = [];
        const sorted = [...transfers]
            .filter((tx) => tx?.id && !isPendingTransfer(tx) && transferBelongsToWallet(tx, nextWalletPK))
            .sort((a, b) => txCreatedMs(b) - txCreatedMs(a));
        for (const tx of sorted) {
            const id = String(tx.id);
            byId[id] = jsonClean(tx);
            ids.push(id);
        }
        payload.transfersById = byId;
        payload.transferIds = ids;
        payload.transferWalletPK = nextWalletPK;
        payload.transferHistoryComplete = historyComplete === true;
        payload.transferNextOffset = Number.isFinite(nextOffset) ? nextOffset : ids.length;
        payload.transferOldestMs = historyComplete === true && Number.isFinite(oldestTxMs) ? oldestTxMs : walletChanged ? null : payload.transferOldestMs ?? null;
        return payload;
    });
}
