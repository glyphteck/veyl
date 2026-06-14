'use client';

import { isPendingTransfer, isVisibleTransfer, transferBelongsToWallet, txCreatedMs } from '../../wallet/tx.js';
import { lowerText, sameText } from '../../utils/text.js';
import { jsonClean } from './schema.js';

function emptyTransferState(extra = {}) {
    return { transfers: [], historyComplete: false, nextOffset: 0, oldestTxMs: null, walletPK: null, rejectReason: null, ...extra };
}

function cachedTransfers(ids, byId, include) {
    return (ids.length ? ids : Object.keys(byId))
        .map((id) => byId[id])
        .filter(Boolean)
        .filter(include)
        .filter(isVisibleTransfer);
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
    const ids = Array.isArray(payload.transferIds) ? payload.transferIds.filter(Boolean) : [];
    const pendingIds = Array.isArray(payload.pendingTransferIds) ? payload.pendingTransferIds.filter(Boolean) : [];
    const transfers = cachedTransfers(ids, payload.transfersById || {}, (tx) => !isPendingTransfer(tx));
    const pendingTransfers = cachedTransfers(pendingIds, payload.pendingTransfersById || {}, isPendingTransfer);
    const allTransfers = [...transfers, ...pendingTransfers].sort((a, b) => txCreatedMs(b) - txCreatedMs(a));
    if (requestedWalletPK && allTransfers.some((tx) => !transferBelongsToWallet(tx, requestedWalletPK))) {
        return emptyTransferState({ walletPK: cachedWalletPK, rejectReason: 'non-owned-transfer' });
    }
    const cachedNextOffset = Number.isFinite(payload.transferNextOffset) ? payload.transferNextOffset : allTransfers.length;
    const nextOffset = Math.min(Math.max(0, cachedNextOffset), allTransfers.length);
    const oldestTxMs = Number.isFinite(payload.transferOldestMs) ? payload.transferOldestMs : null;
    return {
        transfers: allTransfers,
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
            payload.pendingTransfersById = {};
            payload.pendingTransferIds = [];
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
        const pendingById = {};
        const pendingIds = [];
        const sorted = [...transfers]
            .filter((tx) => tx?.id && isVisibleTransfer(tx) && transferBelongsToWallet(tx, nextWalletPK))
            .sort((a, b) => txCreatedMs(b) - txCreatedMs(a));
        for (const tx of sorted) {
            const id = String(tx.id);
            if (isPendingTransfer(tx)) {
                pendingById[id] = jsonClean(tx);
                pendingIds.push(id);
            } else {
                byId[id] = jsonClean(tx);
                ids.push(id);
            }
        }
        payload.transfersById = byId;
        payload.transferIds = ids;
        payload.pendingTransfersById = pendingById;
        payload.pendingTransferIds = pendingIds;
        payload.transferWalletPK = nextWalletPK;
        payload.transferHistoryComplete = historyComplete === true;
        payload.transferNextOffset = Number.isFinite(nextOffset) ? nextOffset : ids.length + pendingIds.length;
        payload.transferOldestMs = historyComplete === true && Number.isFinite(oldestTxMs) ? oldestTxMs : walletChanged ? null : payload.transferOldestMs ?? null;
        return payload;
    });
}
