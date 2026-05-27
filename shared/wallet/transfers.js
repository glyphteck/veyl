import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { readCachedTransfers, writeCachedTransfers } from '../localdatacache.js';
import { markDiag, markDone, markError } from './diag.js';

export const RECENT_TRANSFER_LIMIT = 50;
const INITIAL_TRANSFER_LIMIT = RECENT_TRANSFER_LIMIT;
const FINAL_TRANSFER_STATUSES = new Set(['TRANSFER_STATUS_COMPLETED', 'TRANSFER_STATUS_EXPIRED', 'TRANSFER_STATUS_RETURNED', 'UNRECOGNIZED']);

export function isPendingTransfer(tx) {
    const status = typeof tx?.status === 'string' ? tx.status : '';
    return !!status && !FINAL_TRANSFER_STATUSES.has(status);
}

function sameTransfers(a = [], b = []) {
    if (a === b) {
        return true;
    }

    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        const left = a[i];
        const right = b[i];
        if (
            left?.id !== right?.id ||
            left?.status !== right?.status ||
            left?.createdTime !== right?.createdTime ||
            left?.totalValue !== right?.totalValue ||
            left?.type !== right?.type ||
            left?.transferDirection !== right?.transferDirection ||
            left?.senderIdentityPublicKey !== right?.senderIdentityPublicKey ||
            left?.receiverIdentityPublicKey !== right?.receiverIdentityPublicKey
        ) {
            return false;
        }
    }

    return true;
}

function sameTransferForSync(a, b) {
    return sameTransfers(a ? [a] : [], b ? [b] : []);
}

export function useWalletTransfers({ wallet, localCache, diag }) {
    const [transfers, setTransfers] = useState([]);
    const [txReady, setTxReady] = useState(false);
    const [isTxLoading, setIsTxLoading] = useState(false);
    const transfersRef = useRef([]);

    const transferCount = transfers.length;
    const hasPendingTxs = useMemo(() => transfers.slice(0, RECENT_TRANSFER_LIMIT).some(isPendingTransfer), [transfers]);

    useEffect(() => {
        transfersRef.current = transfers;
    }, [transfers]);

    const setNextTransfers = useCallback((latestTransfers = []) => {
        setTransfers((currentTransfers) => {
            if (!currentTransfers.length) {
                return latestTransfers;
            }

            const recentIds = new Set(latestTransfers.map((tx) => tx.id));
            const nextTransfers = [...latestTransfers];
            for (const tx of currentTransfers) {
                if (!recentIds.has(tx.id)) {
                    nextTransfers.push(tx);
                }
            }
            return sameTransfers(currentTransfers, nextTransfers) ? currentTransfers : nextTransfers;
        });
    }, []);

    const getRecentTxs = useCallback(async () => {
        if (!wallet) {
            return null;
        }

        const startedAt = Date.now();
        markDiag(diag, 'wallet.recentTxs.start', { limit: INITIAL_TRANSFER_LIMIT });
        setIsTxLoading(true);
        try {
            const page = await wallet.getTransfers(INITIAL_TRANSFER_LIMIT, 0);
            const latestTransfers = Array.isArray(page?.transfers) ? page.transfers : [];
            setNextTransfers(latestTransfers);
            const result = {
                transfers: latestTransfers,
                offset: page?.offset,
                hasMore: latestTransfers.length >= INITIAL_TRANSFER_LIMIT && page?.offset != null,
            };
            markDone(diag, 'wallet.recentTxs', startedAt, { count: latestTransfers.length, hasMore: result.hasMore });
            return result;
        } catch (error) {
            markError(diag, 'wallet.recentTxs', startedAt, error);
            console.debug?.('could not get recent transfers', error?.message ?? error);
            return null;
        } finally {
            setTxReady(true);
            setIsTxLoading(false);
        }
    }, [diag, wallet, setNextTransfers]);

    const getAllTxs = useCallback(
        async (firstPage = null) => {
            if (!wallet) {
                return;
            }

            setIsTxLoading(true);
            const startedAt = Date.now();
            let pages = Array.isArray(firstPage?.transfers) && firstPage.transfers.length ? 1 : 0;
            markDiag(diag, 'wallet.allTxs.start', { seeded: !!firstPage, seededCount: firstPage?.transfers?.length || 0 });
            try {
                const limit = RECENT_TRANSFER_LIMIT;
                const seededTransfers = Array.isArray(firstPage?.transfers) ? firstPage.transfers : [];
                const cachedTransfers = transfersRef.current;
                const cachedById = new Map(cachedTransfers.filter((tx) => tx?.id).map((tx) => [tx.id, tx]));
                const pendingCachedIds = new Set(cachedTransfers.filter(isPendingTransfer).map((tx) => tx.id).filter(Boolean));
                let offset = firstPage?.offset ?? 0;
                const nextTransfers = [];
                let shouldFetch = !firstPage || firstPage.hasMore;
                let reachedCacheBoundary = false;

                const appendPage = (pageTransfers = []) => {
                    let reachedStableCachedBoundary = false;
                    for (const tx of pageTransfers) {
                        if (!tx?.id) {
                            continue;
                        }

                        nextTransfers.push(tx);
                        pendingCachedIds.delete(tx.id);

                        const cached = cachedById.get(tx.id);
                        if (cached && sameTransferForSync(tx, cached)) {
                            reachedStableCachedBoundary = true;
                        }
                    }
                    return reachedStableCachedBoundary && pendingCachedIds.size === 0;
                };

                if (appendPage(seededTransfers)) {
                    reachedCacheBoundary = true;
                    shouldFetch = false;
                }

                while (shouldFetch) {
                    const { transfers: txs = [], offset: nextOffset } = await wallet.getTransfers(limit, offset);
                    pages += 1;
                    if (appendPage(txs)) {
                        reachedCacheBoundary = true;
                        break;
                    }
                    if (txs.length < limit) {
                        break;
                    }
                    if (nextOffset == null || nextOffset === offset) {
                        break;
                    }
                    offset = nextOffset;
                    shouldFetch = true;
                }
                if (reachedCacheBoundary) {
                    setNextTransfers(nextTransfers);
                } else {
                    setTransfers((currentTransfers) => (sameTransfers(currentTransfers, nextTransfers) ? currentTransfers : nextTransfers));
                }
                markDone(diag, 'wallet.allTxs', startedAt, { pages, count: nextTransfers.length, reachedCacheBoundary });
            } catch (error) {
                markError(diag, 'wallet.allTxs', startedAt, error, { pages });
                console.debug?.('could not get all transfers', error?.message ?? error);
            } finally {
                setTxReady(true);
                setIsTxLoading(false);
            }
        },
        [diag, wallet, setNextTransfers]
    );

    const resetTransfers = useCallback(() => {
        setTransfers([]);
        setTxReady(false);
        setIsTxLoading(false);
        transfersRef.current = [];
    }, []);

    useEffect(() => {
        if (!wallet || !localCache) {
            return;
        }

        const startedAt = Date.now();
        const cachedTransfers = readCachedTransfers(localCache);
        markDiag(diag, 'wallet.provider.cache.hydrate', { elapsedMs: Date.now() - startedAt, count: cachedTransfers.length });
        if (!cachedTransfers.length) {
            return;
        }

        setTransfers((currentTransfers) => (sameTransfers(currentTransfers, cachedTransfers) ? currentTransfers : cachedTransfers));
        setTxReady(true);
    }, [diag, wallet, localCache]);

    useEffect(() => {
        if (!wallet || !localCache || !txReady) {
            return;
        }

        writeCachedTransfers(localCache, transfers);
    }, [wallet, localCache, transfers, txReady]);

    return {
        transfers,
        txReady,
        isTxLoading,
        transferCount,
        hasPendingTxs,
        getRecentTxs,
        getAllTxs,
        resetTransfers,
    };
}
