import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { WALLET_RECENT_TRANSFER_LIMIT, WALLET_TRANSFER_FETCH_THROTTLE_MS, WALLET_TRANSFER_PAGE_LIMIT } from '../config.js';
import { readCachedTransferState, writeCachedTransferState } from '../cache/localdata.js';
import { sleep } from '../utils/async.js';
import { markDiag, markDone, markError } from '../utils/diagnostics.js';
import { isPendingTransfer, txCreatedMs } from './tx.js';

export const RECENT_TRANSFER_LIMIT = WALLET_RECENT_TRANSFER_LIMIT;
export const TRANSFER_PAGE_LIMIT = WALLET_TRANSFER_PAGE_LIMIT;
const INITIAL_TRANSFER_LIMIT = RECENT_TRANSFER_LIMIT;
const TRANSFER_FETCH_THROTTLE_MS = WALLET_TRANSFER_FETCH_THROTTLE_MS;
export { isPendingTransfer };

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
            txCreatedMs(left) !== txCreatedMs(right) ||
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

function getOldestTransferMs(transfers = []) {
    let oldest = null;
    for (const tx of transfers) {
        const ms = txCreatedMs(tx);
        if (!ms) continue;
        oldest = oldest == null ? ms : Math.min(oldest, ms);
    }
    return oldest;
}

function mergeTransferPage(currentTransfers = [], pageTransfers = [], position = 'append') {
    const seen = new Set();
    const nextTransfers = [];
    const add = (tx) => {
        if (!tx?.id || seen.has(tx.id)) {
            return;
        }
        seen.add(tx.id);
        nextTransfers.push(tx);
    };

    if (position === 'prepend') {
        pageTransfers.forEach(add);
        currentTransfers.forEach(add);
    } else {
        currentTransfers.forEach(add);
        pageTransfers.forEach(add);
    }

    return nextTransfers;
}

function getNextOffset(page, currentOffset, pageTransfers) {
    const returnedOffset = Number(page?.offset);
    if (Number.isFinite(returnedOffset) && returnedOffset > currentOffset) {
        return returnedOffset;
    }
    return currentOffset + pageTransfers.length;
}

function hasMorePage(pageTransfers, limit) {
    return pageTransfers.length >= limit;
}

export function useWalletTransfers({ wallet, localCache, diag }) {
    const [transfers, setTransfers] = useState([]);
    const [txReady, setTxReady] = useState(false);
    const [isTxLoading, setIsTxLoading] = useState(false);
    const [historyComplete, setHistoryComplete] = useState(false);
    const transfersRef = useRef([]);
    const historyCompleteRef = useRef(false);
    const nextOffsetRef = useRef(0);
    const recentFetchPromiseRef = useRef(null);
    const fetchPromiseRef = useRef(null);
    const transferFetchQueueRef = useRef(Promise.resolve());
    const lastFetchAtRef = useRef(0);
    const cacheWriteRef = useRef({ timer: null, cache: null, state: null });

    const transferCount = transfers.length;
    const oldestLoadedMs = useMemo(() => getOldestTransferMs(transfers), [transfers]);
    const hasPendingTxs = useMemo(() => transfers.slice(0, RECENT_TRANSFER_LIMIT).some(isPendingTransfer), [transfers]);

    useEffect(() => {
        transfersRef.current = transfers;
    }, [transfers]);

    const setHistoryCompleteValue = useCallback((next) => {
        historyCompleteRef.current = next === true;
        setHistoryComplete((current) => (current === historyCompleteRef.current ? current : historyCompleteRef.current));
    }, []);

    const setNextOffset = useCallback((nextOffset) => {
        if (Number.isFinite(nextOffset)) {
            nextOffsetRef.current = Math.max(nextOffsetRef.current || 0, nextOffset);
        }
    }, []);

    const commitTransfers = useCallback((pageTransfers = [], position = 'append') => {
        const nextTransfers = mergeTransferPage(transfersRef.current, pageTransfers, position);
        if (sameTransfers(transfersRef.current, nextTransfers)) {
            return transfersRef.current;
        }
        transfersRef.current = nextTransfers;
        setTransfers((currentTransfers) => (sameTransfers(currentTransfers, nextTransfers) ? currentTransfers : nextTransfers));
        return nextTransfers;
    }, []);

    const waitForFetchSlot = useCallback(async () => {
        const elapsed = Date.now() - lastFetchAtRef.current;
        if (elapsed > 0 && elapsed < TRANSFER_FETCH_THROTTLE_MS) {
            await sleep(TRANSFER_FETCH_THROTTLE_MS - elapsed);
        }
        lastFetchAtRef.current = Date.now();
    }, []);

    const flushTransferCache = useCallback(() => {
        const pending = cacheWriteRef.current;
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        pending.timer = null;
        if (pending.cache && pending.state) {
            writeCachedTransferState(pending.cache, pending.state);
        }
        pending.state = null;
    }, []);

    const fetchTransfersPage = useCallback(
        async (limit, offset, createdAfter = undefined, createdBefore = undefined) => {
            const run = async () => {
                await waitForFetchSlot();
                return wallet.getTransfers(limit, offset, createdAfter, createdBefore);
            };
            const request = transferFetchQueueRef.current.then(run, run);
            transferFetchQueueRef.current = request.catch(() => {});
            return request;
        },
        [wallet, waitForFetchSlot]
    );

    const hasCoverage = useCallback((sinceMs) => {
        if (historyCompleteRef.current) return true;
        if (!Number.isFinite(sinceMs)) return false;
        const oldest = getOldestTransferMs(transfersRef.current);
        return oldest != null && oldest <= sinceMs;
    }, []);

    const fetchUntil = useCallback(
        async ({ sinceMs = null, allHistory = false, maxPages = Infinity, label = 'wallet.txs' } = {}) => {
            if (!wallet) {
                return { loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current };
            }

            if (recentFetchPromiseRef.current) {
                await recentFetchPromiseRef.current;
            }
            if (fetchPromiseRef.current) {
                await fetchPromiseRef.current;
            }

            if (historyCompleteRef.current || (!allHistory && Number.isFinite(sinceMs) && hasCoverage(sinceMs))) {
                return { loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current };
            }

            const run = async () => {
                setIsTxLoading(true);
                const startedAt = Date.now();
                let pages = 0;
                markDiag(diag, `${label}.start`, { sinceMs: Number.isFinite(sinceMs) ? sinceMs : null, allHistory: !!allHistory, maxPages: Number.isFinite(maxPages) ? maxPages : null });
                try {
                    while (!historyCompleteRef.current && pages < maxPages) {
                        if (!allHistory && Number.isFinite(sinceMs) && hasCoverage(sinceMs)) {
                            break;
                        }

                        const offset = nextOffsetRef.current;
                        const page = await fetchTransfersPage(TRANSFER_PAGE_LIMIT, offset);
                        const pageTransfers = Array.isArray(page?.transfers) ? page.transfers : [];
                        const nextOffset = getNextOffset(page, offset, pageTransfers);
                        pages += 1;

                        if (pageTransfers.length) {
                            commitTransfers(pageTransfers, 'append');
                        }

                        if (!hasMorePage(pageTransfers, TRANSFER_PAGE_LIMIT)) {
                            setHistoryCompleteValue(true);
                            break;
                        }

                        setNextOffset(nextOffset);
                    }
                    markDone(diag, label, startedAt, { pages, loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current });
                } catch (error) {
                    markError(diag, label, startedAt, error, { pages });
                    console.debug?.('could not fetch transfer history', error?.message ?? error);
                } finally {
                    setTxReady(true);
                    setIsTxLoading(false);
                }

                return { loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current };
            };

            fetchPromiseRef.current = run().finally(() => {
                fetchPromiseRef.current = null;
            });

            return fetchPromiseRef.current;
        },
        [commitTransfers, diag, fetchTransfersPage, hasCoverage, setHistoryCompleteValue, setNextOffset, wallet]
    );

    const getRecentTxs = useCallback(async () => {
        if (!wallet) {
            return null;
        }
        if (recentFetchPromiseRef.current) {
            return recentFetchPromiseRef.current;
        }

        const run = async () => {
            const startedAt = Date.now();
            markDiag(diag, 'wallet.recentTxs.start', { limit: INITIAL_TRANSFER_LIMIT });
            setIsTxLoading(true);
            try {
                const page = await fetchTransfersPage(INITIAL_TRANSFER_LIMIT, 0);
                const latestTransfers = Array.isArray(page?.transfers) ? page.transfers : [];
                commitTransfers(latestTransfers, 'prepend');
                const nextOffset = getNextOffset(page, 0, latestTransfers);
                const hasMore = hasMorePage(latestTransfers, INITIAL_TRANSFER_LIMIT);
                setNextOffset(hasMore ? nextOffset : latestTransfers.length);
                setHistoryCompleteValue(!hasMore);
                const result = {
                    transfers: latestTransfers,
                    offset: nextOffset,
                    hasMore,
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
        };

        recentFetchPromiseRef.current = run().finally(() => {
            recentFetchPromiseRef.current = null;
        });
        return recentFetchPromiseRef.current;
    }, [commitTransfers, diag, fetchTransfersPage, setHistoryCompleteValue, setNextOffset, wallet]);

    const ensureTxCoverage = useCallback((sinceMs = null) => fetchUntil({ sinceMs, allHistory: !Number.isFinite(sinceMs), label: 'wallet.ensureTxCoverage' }), [fetchUntil]);

    const loadMoreTxs = useCallback(() => fetchUntil({ maxPages: 1, label: 'wallet.moreTxs' }), [fetchUntil]);

    const resetTransfers = useCallback(() => {
        setTransfers([]);
        setTxReady(false);
        setIsTxLoading(false);
        setHistoryCompleteValue(false);
        transfersRef.current = [];
        nextOffsetRef.current = 0;
        recentFetchPromiseRef.current = null;
        fetchPromiseRef.current = null;
        transferFetchQueueRef.current = Promise.resolve();
    }, [setHistoryCompleteValue]);

    useEffect(() => {
        if (!wallet || !localCache) {
            return;
        }

        const startedAt = Date.now();
        const cached = readCachedTransferState(localCache);
        markDiag(diag, 'wallet.provider.cache.hydrate', { elapsedMs: Date.now() - startedAt, count: cached.transfers.length, historyComplete: cached.historyComplete });
        if (!cached.transfers.length) {
            return;
        }

        transfersRef.current = cached.transfers;
        nextOffsetRef.current = cached.nextOffset;
        setHistoryCompleteValue(cached.historyComplete);
        setTransfers((currentTransfers) => (sameTransfers(currentTransfers, cached.transfers) ? currentTransfers : cached.transfers));
        setTxReady(true);
    }, [diag, wallet, localCache, setHistoryCompleteValue]);

    useEffect(() => {
        if (!wallet || !localCache || !txReady) {
            return;
        }

        cacheWriteRef.current.cache = localCache;
        cacheWriteRef.current.state = {
            transfers,
            historyComplete,
            nextOffset: nextOffsetRef.current,
        };
        if (cacheWriteRef.current.timer) {
            clearTimeout(cacheWriteRef.current.timer);
        }
        cacheWriteRef.current.timer = setTimeout(flushTransferCache, 500);
        return () => {
            if (cacheWriteRef.current.timer) {
                clearTimeout(cacheWriteRef.current.timer);
                cacheWriteRef.current.timer = null;
            }
        };
    }, [wallet, localCache, transfers, txReady, historyComplete, flushTransferCache]);

    useEffect(() => () => flushTransferCache(), [flushTransferCache]);

    return {
        transfers,
        txReady,
        isTxLoading,
        transferCount,
        oldestLoadedMs,
        historyComplete,
        hasMoreTxs: !historyComplete,
        hasPendingTxs,
        getRecentTxs,
        ensureTxCoverage,
        loadMoreTxs,
        resetTransfers,
    };
}
