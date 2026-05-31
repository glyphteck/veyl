'use client';

import { txCreatedMs } from '../../wallet/tx.js';
import { lowerText, sameText } from '../../utils/text.js';
import { jsonClean } from './schema.js';

function emptyTransferState(extra = {}) {
    return { transfers: [], historyComplete: false, nextOffset: 0, oldestTxMs: null, walletPK: null, ...extra };
}

export function readCachedTransferState(cache, { walletPK = null } = {}) {
    const payload = cache?.read?.();
    if (!payload?.transfersById) {
        return emptyTransferState();
    }
    const cachedWalletPK = lowerText(payload.transferWalletPK);
    if (cachedWalletPK && walletPK && !sameText(cachedWalletPK, walletPK)) {
        return emptyTransferState({ walletPK: cachedWalletPK });
    }
    const ids = Array.isArray(payload.transferIds) && payload.transferIds.length ? payload.transferIds : Object.keys(payload.transfersById);
    const transfers = ids
        .map((id) => payload.transfersById[id])
        .filter(Boolean)
        .sort((a, b) => txCreatedMs(b) - txCreatedMs(a));
    const nextOffset = Number.isFinite(payload.transferNextOffset) ? payload.transferNextOffset : transfers.length;
    const oldestTxMs = Number.isFinite(payload.transferOldestMs) ? payload.transferOldestMs : null;
    return {
        transfers,
        historyComplete: payload.transferHistoryComplete === true,
        nextOffset,
        oldestTxMs,
        walletPK: cachedWalletPK || null,
    };
}

export function readCachedTransfers(cache) {
    return readCachedTransferState(cache).transfers;
}

export function writeCachedTransferState(cache, { transfers, walletPK = null, historyComplete = false, nextOffset = null, oldestTxMs = null } = {}) {
    if (!cache?.patch || !Array.isArray(transfers)) {
        return;
    }

    void cache.patch((payload) => {
        const nextWalletPK = lowerText(walletPK);
        const previousWalletPK = lowerText(payload.transferWalletPK);
        const walletChanged = !!(nextWalletPK && previousWalletPK && !sameText(nextWalletPK, previousWalletPK));
        const byId = {};
        const ids = [];
        const sorted = [...transfers].filter((tx) => tx?.id).sort((a, b) => txCreatedMs(b) - txCreatedMs(a));
        for (const tx of sorted) {
            const id = String(tx.id);
            byId[id] = jsonClean(tx);
            ids.push(id);
        }
        payload.transfersById = byId;
        payload.transferIds = ids;
        payload.transferWalletPK = nextWalletPK || payload.transferWalletPK || null;
        payload.transferHistoryComplete = historyComplete === true;
        payload.transferNextOffset = Number.isFinite(nextOffset) ? nextOffset : ids.length;
        payload.transferOldestMs = historyComplete === true && Number.isFinite(oldestTxMs) ? oldestTxMs : walletChanged ? null : payload.transferOldestMs ?? null;
        return payload;
    });
}

export function writeCachedTransfers(cache, transfers) {
    writeCachedTransferState(cache, { transfers });
}
