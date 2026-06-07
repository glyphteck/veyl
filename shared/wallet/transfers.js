import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { WALLET_RECENT_TRANSFER_LIMIT, WALLET_TRANSFER_CACHE_WRITE_DELAY_MS, WALLET_TRANSFER_FETCH_THROTTLE_MS, WALLET_TRANSFER_PAGE_LIMIT } from '../config.js';
import { readCachedTransferState, writeCachedTransferState } from '../cache/localdata.js';
import { toHex } from '../crypto/core.js';
import { sleep } from '../utils/async.js';
import { markDiag, markDone, markError } from '../utils/diagnostics.js';
import { lowerText } from '../utils/text.js';
import { isPendingTransfer, transferBelongsToWallet, txCreatedMs, txUpdatedMs } from './tx.js';

export const RECENT_TRANSFER_LIMIT = WALLET_RECENT_TRANSFER_LIMIT;
export const TRANSFER_PAGE_LIMIT = WALLET_TRANSFER_PAGE_LIMIT;
const INITIAL_TRANSFER_LIMIT = 20;
const TRANSFER_REVEAL_BATCH_SIZE = 24;
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

function mergeTransferPageForWallet(currentTransfers = [], pageTransfers = [], walletPK, position = 'append') {
    const current = filterTransfersForWallet(currentTransfers, walletPK);
    const page = filterTransfersForWallet(pageTransfers, walletPK);
    return mergeTransferPage(current, page, position);
}

function mergeRecentSnapshotForWallet(currentTransfers = [], latestTransfers = [], walletPK) {
    const latest = mergeTransferPageForWallet([], latestTransfers, walletPK, 'append');
    if (!latest.length) {
        return filterTransfersForWallet(currentTransfers, walletPK);
    }

    const latestIds = new Set(latest.map((tx) => String(tx.id)));
    const oldestLatestMs = getOldestTransferMs(latest);
    const olderCurrent = filterTransfersForWallet(currentTransfers, walletPK).filter((tx) => {
        if (latestIds.has(String(tx?.id))) {
            return false;
        }
        if (isPendingTransfer(tx)) {
            return false;
        }
        const createdMs = txCreatedMs(tx);
        return oldestLatestMs == null || (createdMs > 0 && createdMs < oldestLatestMs);
    });

    return mergeTransferPage(latest, olderCurrent, 'append');
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

function coverageLimitFor(transfers = [], sinceMs = null, allHistory = false, historyComplete = false) {
    if (!transfers.length) {
        return 0;
    }
    if (allHistory) {
        return historyComplete ? transfers.length : 0;
    }
    if (!Number.isFinite(sinceMs)) {
        return 0;
    }
    for (let i = 0; i < transfers.length; i++) {
        const createdMs = txCreatedMs(transfers[i]);
        if (createdMs > 0 && createdMs <= sinceMs) {
            return i + 1;
        }
    }
    return 0;
}

export function useWalletTransfers({ wallet, walletPK, localCache, diag }) {
    const [transfers, setTransfers] = useState([]);
    const [txReady, setTxReady] = useState(false);
    const [isTxLoading, setIsTxLoading] = useState(false);
    const [historyComplete, setHistoryComplete] = useState(false);
    const [oldestVerifiedTxMs, setOldestVerifiedTxMs] = useState(null);
    const [transferCacheVersion, setTransferCacheVersion] = useState(0);
    const transfersRef = useRef([]);
    const historyTransfersRef = useRef([]);
    const txReadyRef = useRef(false);
    const historyCompleteRef = useRef(false);
    const serverHistoryCompleteRef = useRef(false);
    const oldestVerifiedTxMsRef = useRef(null);
    const historyVerifiedRef = useRef(false);
    const walletPKRef = useRef(lowerText(walletPK));
    const nextOffsetRef = useRef(0);
    const visibleTransferLimitRef = useRef(INITIAL_TRANSFER_LIMIT);
    const recentFetchPromiseRef = useRef(null);
    const fetchPromiseRef = useRef(null);
    const transferFetchQueueRef = useRef(Promise.resolve());
    const lastFetchAtRef = useRef(0);
    const cacheWriteRef = useRef({ timer: null, cache: null, state: null });

    const [historyTransferCount, setHistoryTransferCount] = useState(0);
    const transferCount = transfers.length;
    const oldestLoadedMs = useMemo(() => getOldestTransferMs(transfers), [transfers]);
    const oldestKnownTxMs = useMemo(() => getOldestTransferMs(historyTransfersRef.current), [historyTransferCount, transferCacheVersion]);
    const hasPendingTxs = useMemo(() => transfers.slice(0, RECENT_TRANSFER_LIMIT).some(isPendingTransfer), [transfers]);

    useEffect(() => {
        transfersRef.current = transfers;
    }, [transfers]);

    useEffect(() => {
        walletPKRef.current = lowerText(walletPK);
        const nextHistoryTransfers = filterTransfersForWallet(historyTransfersRef.current, walletPKRef.current);
        if (!sameTransfers(historyTransfersRef.current, nextHistoryTransfers)) {
            historyTransfersRef.current = nextHistoryTransfers;
            setHistoryTransferCount((current) => (current === nextHistoryTransfers.length ? current : nextHistoryTransfers.length));
        }
        const nextTransfers = filterTransfersForWallet(transfersRef.current, walletPKRef.current);
        if (!sameTransfers(transfersRef.current, nextTransfers)) {
            transfersRef.current = nextTransfers;
            setTransfers((currentTransfers) => (sameTransfers(currentTransfers, nextTransfers) ? currentTransfers : nextTransfers));
        }
        const nextComplete = serverHistoryCompleteRef.current && nextTransfers.length >= nextHistoryTransfers.length;
        historyCompleteRef.current = nextComplete;
        setHistoryComplete((current) => (current === nextComplete ? current : nextComplete));
    }, [walletPK]);

    const setHistoryCompleteValue = useCallback((next) => {
        historyCompleteRef.current = next === true;
        setHistoryComplete((current) => (current === historyCompleteRef.current ? current : historyCompleteRef.current));
    }, []);

    const syncPublishedHistoryComplete = useCallback((visibleCount = transfersRef.current.length, historyCount = historyTransfersRef.current.length) => {
        const next = serverHistoryCompleteRef.current && visibleCount >= historyCount;
        setHistoryCompleteValue(next);
    }, [setHistoryCompleteValue]);

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

    const commitTransferSnapshot = useCallback((nextTransfers = [], { publish = true, limit = visibleTransferLimitRef.current } = {}) => {
        const ownWalletPK = walletPKRef.current;
        const ownedTransfers = filterTransfersForWallet(nextTransfers, ownWalletPK);
        const historyChanged = !sameTransfers(historyTransfersRef.current, ownedTransfers);
        if (historyChanged) {
            historyTransfersRef.current = ownedTransfers;
            setHistoryTransferCount((current) => (current === ownedTransfers.length ? current : ownedTransfers.length));
            setTransferCacheVersion((current) => current + 1);
        }

        if (!publish) {
            syncPublishedHistoryComplete();
            return ownedTransfers;
        }

        const nextLimit = Number.isFinite(limit) ? Math.max(0, Math.min(ownedTransfers.length, limit)) : ownedTransfers.length;
        visibleTransferLimitRef.current = Math.max(visibleTransferLimitRef.current, nextLimit, Math.min(INITIAL_TRANSFER_LIMIT, ownedTransfers.length));
        const visibleTransfers = ownedTransfers.slice(0, visibleTransferLimitRef.current);
        syncPublishedHistoryComplete(visibleTransfers.length, ownedTransfers.length);
        setOldestVerifiedTxMsValue(serverHistoryCompleteRef.current && visibleTransfers.length >= ownedTransfers.length ? getOldestTransferMs(ownedTransfers) : null);
        if (sameTransfers(transfersRef.current, visibleTransfers)) {
            return ownedTransfers;
        }
        transfersRef.current = visibleTransfers;
        setTransfers((currentTransfers) => (sameTransfers(currentTransfers, visibleTransfers) ? currentTransfers : visibleTransfers));
        return ownedTransfers;
    }, [setOldestVerifiedTxMsValue, syncPublishedHistoryComplete]);

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
        if (serverHistoryCompleteRef.current && transfersRef.current.length >= historyTransfersRef.current.length) return true;
        if (!Number.isFinite(sinceMs)) return false;
        const oldest = getOldestTransferMs(transfersRef.current);
        return oldest != null && oldest <= sinceMs;
    }, []);

    const publishHiddenCoverage = useCallback(
        (sinceMs = null, allHistory = false) => {
            const historyTransfers = historyTransfersRef.current;
            if (!historyTransfers.length || transfersRef.current.length >= historyTransfers.length) {
                syncPublishedHistoryComplete();
                return false;
            }

            const coverageLimit = coverageLimitFor(historyTransfers, sinceMs, allHistory, serverHistoryCompleteRef.current);
            if (!coverageLimit || coverageLimit <= transfersRef.current.length) {
                syncPublishedHistoryComplete();
                return false;
            }

            commitTransferSnapshot(historyTransfers, { publish: true, limit: coverageLimit });
            return true;
        },
        [commitTransferSnapshot, syncPublishedHistoryComplete]
    );

    const fetchUntil = useCallback(
        async ({ sinceMs = null, allHistory = false, maxPages = Infinity, force = false, publish = true, stopAtIds = null, completeOnStop = false, label = 'wallet.txs' } = {}) => {
            if (!wallet || !walletPKRef.current) {
                return { loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current };
            }

            if (recentFetchPromiseRef.current) {
                await recentFetchPromiseRef.current;
            }
            if (fetchPromiseRef.current) {
                await fetchPromiseRef.current;
            }

            if (!force && publishHiddenCoverage(sinceMs, allHistory) && (allHistory || hasCoverage(sinceMs))) {
                return { loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current };
            }

            if (!force && ((serverHistoryCompleteRef.current && transfersRef.current.length >= historyTransfersRef.current.length) || (!allHistory && Number.isFinite(sinceMs) && hasCoverage(sinceMs)))) {
                return { loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current };
            }

            const run = async () => {
                const showLoading = label === 'wallet.moreTxs' || !txReadyRef.current;
                if (showLoading) {
                    setIsTxLoading(true);
                }
                const startedAt = Date.now();
                let pages = 0;
                if (!historyVerifiedRef.current && !(force && nextOffsetRef.current > 0)) {
                    resetNextOffset(completedTransferCount(historyTransfersRef.current.length ? historyTransfersRef.current : transfersRef.current));
                }
                const stopIdSet = stopAtIds instanceof Set ? stopAtIds : new Set((Array.isArray(stopAtIds) ? stopAtIds : []).map((id) => String(id)).filter(Boolean));
                markDiag(diag, `${label}.start`, {
                    sinceMs: Number.isFinite(sinceMs) ? sinceMs : null,
                    allHistory: !!allHistory,
                    force: !!force,
                    publish: !!publish,
                    maxPages: Number.isFinite(maxPages) ? maxPages : null,
                    stopAtCount: stopIdSet.size,
                    completeOnStop: !!completeOnStop,
                });
                try {
                    let stagedTransfers = filterTransfersForWallet(historyTransfersRef.current, walletPKRef.current);
                    let oldestFetchedMs = null;
                    let stoppedAtKnownTransfer = false;
                    const stagedHasCoverage = () => {
                        if (serverHistoryCompleteRef.current) return true;
                        if (!Number.isFinite(sinceMs)) return false;
                        if (force) return oldestFetchedMs != null && oldestFetchedMs <= sinceMs;
                        const oldest = getOldestTransferMs(stagedTransfers);
                        return oldest != null && oldest <= sinceMs;
                    };

                    while ((!serverHistoryCompleteRef.current || force) && pages < maxPages) {
                        if (!allHistory && Number.isFinite(sinceMs) && stagedHasCoverage()) {
                            break;
                        }

                        const offset = nextOffsetRef.current;
                        const page = await fetchTransfersPage(TRANSFER_PAGE_LIMIT, offset);
                        const pageTransfers = Array.isArray(page?.transfers) ? page.transfers : [];
                        const nextOffset = getNextOffset(page, offset, pageTransfers);
                        pages += 1;
                        historyVerifiedRef.current = true;
                        const pageHitStopId = stopIdSet.size > 0 && pageTransfers.some((tx) => stopIdSet.has(String(tx?.id)));

                        if (pageTransfers.length) {
                            stagedTransfers = mergeTransferPageForWallet(stagedTransfers, pageTransfers, walletPKRef.current, 'append');
                            const oldestPageMs = getOldestTransferMs(pageTransfers);
                            if (oldestPageMs != null) {
                                oldestFetchedMs = oldestFetchedMs == null ? oldestPageMs : Math.min(oldestFetchedMs, oldestPageMs);
                            }
                        }

                        setNextOffset(nextOffset);

                        if (pageHitStopId) {
                            stoppedAtKnownTransfer = true;
                            if (completeOnStop) {
                                serverHistoryCompleteRef.current = true;
                            }
                            break;
                        }

                        if (!hasMorePage(pageTransfers, TRANSFER_PAGE_LIMIT)) {
                            serverHistoryCompleteRef.current = true;
                            break;
                        }
                    }
                    const latestTransfers = mergeTransferPageForWallet(historyTransfersRef.current, stagedTransfers, walletPKRef.current, 'append');
                    commitTransferSnapshot(latestTransfers, { publish });
                    markDone(diag, label, startedAt, {
                        pages,
                        loaded: transfersRef.current.length,
                        historyCount: historyTransfersRef.current.length,
                        historyComplete: historyCompleteRef.current,
                        serverHistoryComplete: serverHistoryCompleteRef.current,
                        force: !!force,
                        publish: !!publish,
                        stoppedAtKnownTransfer,
                    });
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
        [commitTransferSnapshot, diag, fetchTransfersPage, hasCoverage, publishHiddenCoverage, resetNextOffset, setNextOffset, setTxReadyValue, wallet]
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
                const previousTransfers = filterTransfersForWallet(historyTransfersRef.current, walletPKRef.current);
                const previousHistoryComplete = serverHistoryCompleteRef.current;
                const [page, pendingTransfers] = await Promise.all([fetchTransfersPage(INITIAL_TRANSFER_LIMIT, 0), getPendingIncomingTransfers(wallet, diag)]);
                const pageTransfers = Array.isArray(page?.transfers) ? page.transfers : [];
                const latestTransfers = mergeTransferPage(pendingTransfers, pageTransfers, 'prepend');
                const latestIds = new Set(latestTransfers.map((tx) => String(tx?.id)).filter(Boolean));
                const reconcileIds = previousTransfers
                    .filter((tx) => tx?.id && !latestIds.has(String(tx.id)) && !isPendingTransfer(tx))
                    .map((tx) => String(tx.id));
                const nextOffset = getNextOffset(page, 0, pageTransfers);
                const pageHasMore = hasMorePage(pageTransfers, INITIAL_TRANSFER_LIMIT);
                const fetchedTransfers = pageHasMore ? mergeRecentSnapshotForWallet(previousTransfers, latestTransfers, walletPKRef.current) : mergeTransferPageForWallet([], latestTransfers, walletPKRef.current);
                const committedTransfers = mergeTransferPageForWallet(historyTransfersRef.current, fetchedTransfers, walletPKRef.current, 'append');
                historyVerifiedRef.current = true;
                resetNextOffset(nextOffset);
                serverHistoryCompleteRef.current = previousHistoryComplete || serverHistoryCompleteRef.current || !pageHasMore;
                commitTransferSnapshot(committedTransfers, { publish: true });
                setOldestVerifiedTxMsValue(historyCompleteRef.current ? getOldestTransferMs(committedTransfers) : null);
                const result = {
                    transfers: transfersRef.current,
                    offset: nextOffset,
                    hasMore: pageHasMore || !historyCompleteRef.current,
                    reconcileIds,
                    cachedHistoryComplete: previousHistoryComplete,
                    historyCount: historyTransfersRef.current.length,
                };
                markDone(diag, 'wallet.recentTxs', startedAt, {
                    count: transfersRef.current.length,
                    historyCount: historyTransfersRef.current.length,
                    pendingCount: pendingTransfers.length,
                    pageCount: pageTransfers.length,
                    hasMore: result.hasMore,
                    serverHistoryComplete: serverHistoryCompleteRef.current,
                });
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
    }, [commitTransferSnapshot, diag, fetchTransfersPage, resetNextOffset, setOldestVerifiedTxMsValue, setTxReadyValue, wallet]);

    const rememberTransfer = useCallback(
        async (transferId) => {
            if (!wallet || !walletPKRef.current || typeof wallet.getTransfer !== 'function' || !transferId) {
                return null;
            }

            const startedAt = Date.now();
            markDiag(diag, 'wallet.claimedTx.start', {});
            try {
                const tx = await wallet.getTransfer(String(transferId));
                const compact = compactTransfer(tx);
                if (!compact || !transferBelongsToWallet(compact, walletPKRef.current)) {
                    markDone(diag, 'wallet.claimedTx', startedAt, { found: false });
                    return null;
                }

                const current = historyTransfersRef.current.length ? historyTransfersRef.current : transfersRef.current;
                const nextTransfers = mergeTransferPageForWallet(current, [tx], walletPKRef.current, 'prepend');
                commitTransferSnapshot(nextTransfers, { publish: true });
                setTxReadyValue(true);
                markDone(diag, 'wallet.claimedTx', startedAt, { found: true });
                return compact;
            } catch (error) {
                markError(diag, 'wallet.claimedTx', startedAt, error);
                console.debug?.('could not get claimed transfer', error?.message ?? error);
                return null;
            }
        },
        [commitTransferSnapshot, diag, setTxReadyValue, wallet]
    );

    const ensureTxCoverage = useCallback(
        (sinceMs = null, options = {}) =>
            fetchUntil({
                sinceMs,
                allHistory: !Number.isFinite(sinceMs),
                force: options.force === true,
                publish: options.publish !== false,
                stopAtIds: options.stopAtIds,
                completeOnStop: options.completeOnStop === true,
                maxPages: options.maxPages ?? Infinity,
                label: options.label || 'wallet.ensureTxCoverage',
            }),
        [fetchUntil]
    );

    const loadMoreTxs = useCallback(async () => {
        const nextLimit = visibleTransferLimitRef.current + TRANSFER_REVEAL_BATCH_SIZE;
        visibleTransferLimitRef.current = nextLimit;
        if (historyTransfersRef.current.length > transfersRef.current.length) {
            commitTransferSnapshot(historyTransfersRef.current, { publish: true, limit: nextLimit });
            markDiag(diag, 'wallet.moreTxs.revealCached', {
                loaded: transfersRef.current.length,
                historyCount: historyTransfersRef.current.length,
                historyComplete: historyCompleteRef.current,
            });
            return { loaded: transfersRef.current.length, historyComplete: historyCompleteRef.current };
        }
        if (recentFetchPromiseRef.current) {
            markDiag(diag, 'wallet.moreTxs.waitRecent', {});
            await recentFetchPromiseRef.current;
        }
        return fetchUntil({ maxPages: 1, publish: true, label: 'wallet.moreTxs' });
    }, [commitTransferSnapshot, diag, fetchUntil]);

    const resetTransfers = useCallback(() => {
        setTransfers([]);
        setTxReadyValue(false);
        setIsTxLoading(false);
        setHistoryCompleteValue(false);
        setOldestVerifiedTxMsValue(null);
        transfersRef.current = [];
        historyTransfersRef.current = [];
        serverHistoryCompleteRef.current = false;
        visibleTransferLimitRef.current = INITIAL_TRANSFER_LIMIT;
        setHistoryTransferCount(0);
        setTransferCacheVersion((current) => current + 1);
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
            rejectReason: cached.rejectReason || null,
        });
        if (!cachedTransfers.length) {
            return;
        }

        const completedCount = completedTransferCount(cachedTransfers);
        const cachedOldestTxMs = Number.isFinite(cached.oldestTxMs) ? cached.oldestTxMs : cached.historyComplete ? getOldestTransferMs(cachedTransfers) : null;
        const trustedComplete = cached.historyComplete && cachedOldestTxMs != null && completedCount === cachedTransfers.length;
        nextOffsetRef.current = Number.isFinite(cached.nextOffset) ? cached.nextOffset : completedCount;
        historyVerifiedRef.current = trustedComplete;
        serverHistoryCompleteRef.current = trustedComplete;
        visibleTransferLimitRef.current = Math.min(INITIAL_TRANSFER_LIMIT, cachedTransfers.length);
        const publishedTransfers = commitTransferSnapshot(cachedTransfers, { publish: true, limit: visibleTransferLimitRef.current });
        setOldestVerifiedTxMsValue(historyCompleteRef.current ? cachedOldestTxMs : null);
        if (!publishedTransfers.length) {
            syncPublishedHistoryComplete();
        }
        setTxReadyValue(true);
    }, [commitTransferSnapshot, diag, wallet, walletPK, localCache, setOldestVerifiedTxMsValue, setTxReadyValue, syncPublishedHistoryComplete]);

    useEffect(() => {
        if (!wallet || !localCache || !txReady) {
            return;
        }

        cacheWriteRef.current.cache = localCache;
        cacheWriteRef.current.state = {
            transfers: historyTransfersRef.current,
            walletPK: walletPKRef.current,
            historyComplete: serverHistoryCompleteRef.current,
            nextOffset: nextOffsetRef.current,
            oldestTxMs: serverHistoryCompleteRef.current ? getOldestTransferMs(historyTransfersRef.current) : null,
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
    }, [wallet, localCache, transfers, txReady, historyTransferCount, transferCacheVersion, flushTransferCache]);

    useEffect(() => () => flushTransferCache(), [flushTransferCache]);

    return {
        transfers,
        historyTransfers: historyTransfersRef.current,
        txReady,
        isTxLoading,
        transferCount,
        historyTransferCount,
        oldestLoadedMs,
        oldestKnownTxMs,
        oldestVerifiedTxMs,
        historyComplete,
        serverHistoryComplete: serverHistoryCompleteRef.current,
        hasMoreTxs: !historyComplete,
        hasPendingTxs,
        getRecentTxs,
        rememberTransfer,
        ensureTxCoverage,
        loadMoreTxs,
        resetTransfers,
    };
}
