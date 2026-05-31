import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { WALLET_RECENT_TRANSFER_LIMIT, WALLET_TRANSFER_CACHE_WRITE_DELAY_MS, WALLET_TRANSFER_FETCH_THROTTLE_MS, WALLET_TRANSFER_PAGE_LIMIT } from '../config.js';
import { readCachedTransferState, writeCachedTransferState } from '../cache/localdata.js';
import { toHex } from '../crypto/core.js';
import { sleep } from '../utils/async.js';
import { markDiag, markDone, markError } from '../utils/diagnostics.js';
import { lowerText, sameText } from '../utils/text.js';
import { isPendingTransfer, txCreatedMs, txUpdatedMs } from './tx.js';

export const RECENT_TRANSFER_LIMIT = WALLET_RECENT_TRANSFER_LIMIT;
export const TRANSFER_PAGE_LIMIT = WALLET_TRANSFER_PAGE_LIMIT;
const INITIAL_TRANSFER_LIMIT = RECENT_TRANSFER_LIMIT;
const TRANSFER_FETCH_THROTTLE_MS = WALLET_TRANSFER_FETCH_THROTTLE_MS;
const TRANSFER_CACHE_WRITE_DELAY_MS = WALLET_TRANSFER_CACHE_WRITE_DELAY_MS;
const TRANSFER_STATUS_BY_CODE = new Map([
    [0, 'TRANSFER_STATUS_SENDER_INITIATED'],
    [1, 'TRANSFER_STATUS_SENDER_KEY_TWEAK_PENDING'],
    [2, 'TRANSFER_STATUS_SENDER_KEY_TWEAKED'],
    [3, 'TRANSFER_STATUS_RECEIVER_KEY_TWEAKED'],
    [4, 'TRANSFER_STATUS_RECEIVER_REFUND_SIGNED'],
    [5, 'TRANSFER_STATUS_COMPLETED'],
    [6, 'TRANSFER_STATUS_EXPIRED'],
    [7, 'TRANSFER_STATUS_RETURNED'],
    [8, 'TRANSFER_STATUS_SENDER_INITIATED_COORDINATOR'],
    [9, 'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_LOCKED'],
    [10, 'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_APPLIED'],
    [11, 'TRANSFER_STATUS_APPLYING_SENDER_KEY_TWEAK'],
    [-1, 'UNRECOGNIZED'],
]);
const TRANSFER_TYPE_BY_CODE = new Map([
    [0, 'PREIMAGE_SWAP'],
    [1, 'COOPERATIVE_EXIT'],
    [2, 'TRANSFER'],
    [3, 'UTXO_SWAP'],
    [4, 'PRIMARY_SWAP_V3'],
    [5, 'COUNTER_SWAP_V3'],
    [30, 'SWAP'],
    [40, 'COUNTER_SWAP'],
    [-1, 'UNRECOGNIZED'],
]);
export { isPendingTransfer };

function compareRecentTransfer(a, b) {
    const delta = txCreatedMs(b) - txCreatedMs(a);
    if (delta !== 0) {
        return delta;
    }
    return String(b?.id || '').localeCompare(String(a?.id || ''));
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
            txCreatedMs(left) !== txCreatedMs(right) ||
            txUpdatedMs(left) !== txUpdatedMs(right) ||
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

function sortRecentTransfers(transfers = []) {
    return [...transfers].sort(compareRecentTransfer);
}

function enumName(value, map) {
    if (typeof value === 'string') {
        return value;
    }
    if (Number.isFinite(value)) {
        return map.get(value) || 'UNRECOGNIZED';
    }
    return 'UNRECOGNIZED';
}

function hexKey(value) {
    if (typeof value === 'string') {
        return lowerText(value);
    }
    try {
        return value ? lowerText(toHex(value)) : '';
    } catch {
        return '';
    }
}

function satValue(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
}

function compactTransfer(tx, { incoming = false } = {}) {
    if (!tx?.id) {
        return null;
    }
    return {
        id: tx.id,
        senderIdentityPublicKey: hexKey(tx.senderIdentityPublicKey),
        receiverIdentityPublicKey: hexKey(tx.receiverIdentityPublicKey),
        status: enumName(tx.status, TRANSFER_STATUS_BY_CODE),
        totalValue: satValue(tx.totalValue),
        createdTime: tx.createdTime,
        updatedTime: tx.updatedTime,
        type: enumName(tx.type, TRANSFER_TYPE_BY_CODE),
        transferDirection: tx.transferDirection || (incoming ? 'INCOMING' : undefined),
    };
}

function completedTransferCount(transfers = []) {
    return transfers.reduce((count, tx) => (isPendingTransfer(tx) ? count : count + 1), 0);
}

function transferBelongsToWallet(tx, walletPK) {
    if (!walletPK) {
        return false;
    }
    return sameText(tx?.senderIdentityPublicKey, walletPK) || sameText(tx?.receiverIdentityPublicKey, walletPK);
}

function filterTransfersForWallet(transfers = [], walletPK) {
    if (!walletPK || !Array.isArray(transfers)) {
        return [];
    }
    return transfers.filter((tx) => transferBelongsToWallet(tx, walletPK));
}

function getOldestTransferMs(transfers = []) {
    let oldest = null;
    for (const tx of transfers) {
        if (isPendingTransfer(tx)) {
            continue;
        }
        const ms = txCreatedMs(tx);
        if (!ms) continue;
        oldest = oldest == null ? ms : Math.min(oldest, ms);
    }
    return oldest;
}

function shouldReplaceTransfer(current, next) {
    if (isPendingTransfer(current) && !isPendingTransfer(next)) {
        return true;
    }
    return false;
}

function mergeTransferPage(currentTransfers = [], pageTransfers = [], position = 'append') {
    const byId = new Map();
    const order = [];
    const add = (tx) => {
        const compact = compactTransfer(tx);
        if (!compact) {
            return;
        }
        const id = String(compact.id);
        const current = byId.get(id);
        if (!current) {
            byId.set(id, compact);
            order.push(id);
            return;
        }
        if (shouldReplaceTransfer(current, compact)) {
            byId.set(id, compact);
        }
    };

    if (position === 'prepend') {
        pageTransfers.forEach(add);
        currentTransfers.forEach(add);
    } else {
        currentTransfers.forEach(add);
        pageTransfers.forEach(add);
    }

    return sortRecentTransfers(order.map((id) => byId.get(id)).filter(Boolean));
}

async function getPendingIncomingTransfers(wallet, diag) {
    const queryPendingTransfers = wallet?.transferService?.queryPendingTransfers;
    if (typeof queryPendingTransfers !== 'function') {
        return [];
    }

    const startedAt = Date.now();
    markDiag(diag, 'wallet.pendingTxs.start', {});
    try {
        const page = await queryPendingTransfers.call(wallet.transferService);
        const rawTransfers = Array.isArray(page?.transfers) ? page.transfers : [];
        if (!rawTransfers.length) {
            markDone(diag, 'wallet.pendingTxs', startedAt, { count: 0 });
            return [];
        }
        const transfers = sortRecentTransfers(rawTransfers.map((tx) => compactTransfer(tx, { incoming: true })).filter(Boolean));
        markDone(diag, 'wallet.pendingTxs', startedAt, { count: transfers.length });
        return transfers;
    } catch (error) {
        markError(diag, 'wallet.pendingTxs', startedAt, error);
        console.debug?.('could not get pending transfers', error?.message ?? error);
        return [];
    }
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

export function useWalletTransfers({ wallet, walletPK, localCache, diag }) {
    const [transfers, setTransfers] = useState([]);
    const [txReady, setTxReady] = useState(false);
    const [isTxLoading, setIsTxLoading] = useState(false);
    const [historyComplete, setHistoryComplete] = useState(false);
    const [oldestVerifiedTxMs, setOldestVerifiedTxMs] = useState(null);
    const transfersRef = useRef([]);
    const txReadyRef = useRef(false);
    const historyCompleteRef = useRef(false);
    const oldestVerifiedTxMsRef = useRef(null);
    const historyVerifiedRef = useRef(false);
    const walletPKRef = useRef(lowerText(walletPK));
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

    useEffect(() => {
        walletPKRef.current = lowerText(walletPK);
        const nextTransfers = filterTransfersForWallet(transfersRef.current, walletPKRef.current);
        if (!sameTransfers(transfersRef.current, nextTransfers)) {
            transfersRef.current = nextTransfers;
            setTransfers((currentTransfers) => (sameTransfers(currentTransfers, nextTransfers) ? currentTransfers : nextTransfers));
        }
    }, [walletPK]);

    const setHistoryCompleteValue = useCallback((next) => {
        historyCompleteRef.current = next === true;
        setHistoryComplete((current) => (current === historyCompleteRef.current ? current : historyCompleteRef.current));
    }, []);

    const setOldestVerifiedTxMsValue = useCallback((next) => {
        oldestVerifiedTxMsRef.current = Number.isFinite(next) ? next : null;
        setOldestVerifiedTxMs((current) => (current === oldestVerifiedTxMsRef.current ? current : oldestVerifiedTxMsRef.current));
    }, []);

    const setTxReadyValue = useCallback((next) => {
        txReadyRef.current = next === true;
        setTxReady((current) => (current === txReadyRef.current ? current : txReadyRef.current));
    }, []);

    const setNextOffset = useCallback((nextOffset) => {
        if (Number.isFinite(nextOffset)) {
            nextOffsetRef.current = Math.max(nextOffsetRef.current || 0, nextOffset);
        }
    }, []);

    const resetNextOffset = useCallback((nextOffset) => {
        nextOffsetRef.current = Number.isFinite(nextOffset) ? Math.max(0, nextOffset) : 0;
    }, []);

    const commitTransfers = useCallback((pageTransfers = [], position = 'append') => {
        const ownWalletPK = walletPKRef.current;
        const currentTransfers = filterTransfersForWallet(transfersRef.current, ownWalletPK);
        const ownedPageTransfers = filterTransfersForWallet(pageTransfers, ownWalletPK);
        const nextTransfers = mergeTransferPage(currentTransfers, ownedPageTransfers, position);
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
            if (!wallet || !walletPKRef.current) {
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
                const showLoading = label === 'wallet.moreTxs' || !txReadyRef.current;
                if (showLoading) {
                    setIsTxLoading(true);
                }
                const startedAt = Date.now();
                let pages = 0;
                if (!historyVerifiedRef.current) {
                    resetNextOffset(completedTransferCount(transfersRef.current));
                }
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
                        historyVerifiedRef.current = true;

                        if (pageTransfers.length) {
                            commitTransfers(pageTransfers, 'append');
                        }

                        setNextOffset(nextOffset);

                        if (!hasMorePage(pageTransfers, TRANSFER_PAGE_LIMIT)) {
                            setHistoryCompleteValue(true);
                            setOldestVerifiedTxMsValue(getOldestTransferMs(transfersRef.current));
                            break;
                        }
                    }
                    markDone(diag, label, startedAt, { pages, loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current });
                } catch (error) {
                    markError(diag, label, startedAt, error, { pages });
                    console.debug?.('could not fetch transfer history', error?.message ?? error);
                } finally {
                    setTxReadyValue(true);
                    if (showLoading) {
                        setIsTxLoading(false);
                    }
                }

                return { loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current };
            };

            fetchPromiseRef.current = run().finally(() => {
                fetchPromiseRef.current = null;
            });

            return fetchPromiseRef.current;
        },
        [commitTransfers, diag, fetchTransfersPage, hasCoverage, resetNextOffset, setHistoryCompleteValue, setNextOffset, setOldestVerifiedTxMsValue, setTxReadyValue, wallet]
    );

    const getRecentTxs = useCallback(async () => {
        if (!wallet || !walletPKRef.current) {
            return null;
        }
        if (recentFetchPromiseRef.current) {
            return recentFetchPromiseRef.current;
        }

        const run = async () => {
            const startedAt = Date.now();
            const showLoading = !txReadyRef.current;
            markDiag(diag, 'wallet.recentTxs.start', { limit: INITIAL_TRANSFER_LIMIT });
            if (showLoading) {
                setIsTxLoading(true);
            }
            try {
                const [page, pendingTransfers] = await Promise.all([fetchTransfersPage(INITIAL_TRANSFER_LIMIT, 0), getPendingIncomingTransfers(wallet, diag)]);
                const pageTransfers = Array.isArray(page?.transfers) ? page.transfers : [];
                const latestTransfers = mergeTransferPage(pendingTransfers, pageTransfers, 'prepend');
                commitTransfers(latestTransfers, 'prepend');
                const nextOffset = getNextOffset(page, 0, pageTransfers);
                if (!hasMorePage(pageTransfers, INITIAL_TRANSFER_LIMIT)) {
                    setHistoryCompleteValue(true);
                    setOldestVerifiedTxMsValue(getOldestTransferMs(latestTransfers));
                }
                setNextOffset(nextOffset);
                const result = {
                    transfers: latestTransfers,
                    offset: nextOffset,
                    hasMore: !historyCompleteRef.current,
                };
                markDone(diag, 'wallet.recentTxs', startedAt, { count: latestTransfers.length, pendingCount: pendingTransfers.length, pageCount: pageTransfers.length, hasMore: result.hasMore });
                return result;
            } catch (error) {
                markError(diag, 'wallet.recentTxs', startedAt, error);
                console.debug?.('could not get recent transfers', error?.message ?? error);
                return null;
            } finally {
                setTxReadyValue(true);
                if (showLoading) {
                    setIsTxLoading(false);
                }
            }
        };

        recentFetchPromiseRef.current = run().finally(() => {
            recentFetchPromiseRef.current = null;
        });
        return recentFetchPromiseRef.current;
    }, [commitTransfers, diag, fetchTransfersPage, resetNextOffset, setHistoryCompleteValue, setNextOffset, setOldestVerifiedTxMsValue, setTxReadyValue, wallet]);

    const ensureTxCoverage = useCallback((sinceMs = null) => fetchUntil({ sinceMs, allHistory: !Number.isFinite(sinceMs), label: 'wallet.ensureTxCoverage' }), [fetchUntil]);

    const loadMoreTxs = useCallback(() => fetchUntil({ maxPages: 1, label: 'wallet.moreTxs' }), [fetchUntil]);

    const resetTransfers = useCallback(() => {
        setTransfers([]);
        setTxReadyValue(false);
        setIsTxLoading(false);
        setHistoryCompleteValue(false);
        setOldestVerifiedTxMsValue(null);
        transfersRef.current = [];
        historyVerifiedRef.current = false;
        nextOffsetRef.current = 0;
        recentFetchPromiseRef.current = null;
        fetchPromiseRef.current = null;
        transferFetchQueueRef.current = Promise.resolve();
    }, [setHistoryCompleteValue, setOldestVerifiedTxMsValue, setTxReadyValue]);

    useEffect(() => {
        if (wallet && walletPKRef.current) {
            return;
        }
        resetTransfers();
    }, [resetTransfers, wallet, walletPK]);

    useEffect(() => {
        if (!wallet || !localCache || !walletPKRef.current) {
            return;
        }

        const startedAt = Date.now();
        const cached = readCachedTransferState(localCache, { walletPK: walletPKRef.current });
        const cachedTransfers = filterTransfersForWallet(cached.transfers, walletPKRef.current);
        markDiag(diag, 'wallet.provider.cache.hydrate', {
            elapsedMs: Date.now() - startedAt,
            count: cached.transfers.length,
            retainedCount: cachedTransfers.length,
            walletPK: cached.walletPK || null,
            historyComplete: cached.historyComplete,
            oldestTxMs: cached.oldestTxMs ?? null,
        });
        if (!cachedTransfers.length) {
            return;
        }

        const completedCount = completedTransferCount(cachedTransfers);
        const cachedOldestTxMs = Number.isFinite(cached.oldestTxMs) ? cached.oldestTxMs : cached.historyComplete ? getOldestTransferMs(cachedTransfers) : null;
        const trustedComplete = cached.historyComplete && cachedOldestTxMs != null && completedCount === cachedTransfers.length;
        transfersRef.current = cachedTransfers;
        nextOffsetRef.current = completedCount;
        historyVerifiedRef.current = trustedComplete;
        setOldestVerifiedTxMsValue(cachedOldestTxMs);
        setHistoryCompleteValue(trustedComplete);
        setTransfers((currentTransfers) => (sameTransfers(currentTransfers, cachedTransfers) ? currentTransfers : cachedTransfers));
        setTxReadyValue(true);
    }, [diag, wallet, walletPK, localCache, setHistoryCompleteValue, setOldestVerifiedTxMsValue, setTxReadyValue]);

    useEffect(() => {
        if (!wallet || !localCache || !txReady) {
            return;
        }

        cacheWriteRef.current.cache = localCache;
        cacheWriteRef.current.state = {
            transfers,
            walletPK: walletPKRef.current,
            historyComplete,
            nextOffset: nextOffsetRef.current,
            oldestTxMs: oldestVerifiedTxMsRef.current ?? (historyComplete ? getOldestTransferMs(transfers) : null),
        };
        if (cacheWriteRef.current.timer) {
            clearTimeout(cacheWriteRef.current.timer);
        }
        cacheWriteRef.current.timer = setTimeout(flushTransferCache, TRANSFER_CACHE_WRITE_DELAY_MS);
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
        oldestVerifiedTxMs,
        historyComplete,
        hasMoreTxs: !historyComplete,
        hasPendingTxs,
        getRecentTxs,
        ensureTxCoverage,
        loadMoreTxs,
        resetTransfers,
    };
}
