'use client';

import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { DAY_MS, HOUR_MS } from '../config.js';
import { dayHourKey, dayKey, hourKey } from '../utils/time.js';
import { isCompletedTransfer, isFundingTransfer, isVisibleTransfer, isWithdrawalTransfer, transferBelongsToWallet, txCreatedMs } from '../wallet/tx.js';
import { markDiag } from '../utils/diagnostics.js';

const byRecentTx = (a, b) => {
    const delta = (b?.createdMs || 0) - (a?.createdMs || 0);
    if (delta !== 0) return delta;
    return String(b?.id || '').localeCompare(String(a?.id || ''));
};

export const TX_TIME_RANGES = Object.freeze(['today', '24h', 7, 30, 90, 180, 365, 'all-time']);

export function getTxRangeStartMs(timeRange, nowMs = Date.now()) {
    if (timeRange === 'today') {
        const today = new Date(nowMs);
        today.setHours(0, 0, 0, 0);
        return today.getTime();
    }
    if (timeRange === '24h') return nowMs - DAY_MS;
    if (typeof timeRange === 'number') return nowMs - timeRange * DAY_MS;
    return null;
}

function coveredUnitsSince(oldestLoadedMs, unitMs, nowMs = Date.now()) {
    if (!oldestLoadedMs) return 1;
    return Math.max(1, Math.ceil((nowMs - oldestLoadedMs) / unitMs) + 1);
}

const enrichTx = (tx) => {
    const incoming = tx.transferDirection === 'INCOMING';
    const isWithdrawal = isWithdrawalTransfer(tx);
    const isFunding = isFundingTransfer(tx);
    const peerPK = incoming ? tx.senderIdentityPublicKey : tx.receiverIdentityPublicKey;
    return {
        ...tx,
        createdMs: txCreatedMs(tx),
        incoming,
        peerPK,
        totalValue: tx.totalValue,
        amount: incoming ? tx.totalValue : -tx.totalValue,
        funding: isFunding,
        withdrawal: isWithdrawal,
        pending: !isCompletedTransfer(tx),
    };
};

const aggregateTxs = (transfers, userPK) => {
    const dayMap = new Map();
    const hourMap = new Map();
    const peerMap = new Map();
    const txById = new Map();
    const peerTxsByPK = new Map();
    let net = 0;
    let vol = 0;
    let firstDate = null;
    let count = 0;
    const enrichedTxs = [];

    for (const raw of transfers) {
        if (userPK && !transferBelongsToWallet(raw, userPK)) {
            continue;
        }
        const tx = enrichTx(raw);
        if (!isVisibleTransfer(tx)) continue;
        enrichedTxs.push(tx);
        if (tx.id) {
            txById.set(tx.id, tx);
        }
        const txDate = new Date(tx.createdMs);

        if (!tx.funding) {
            net += tx.amount;
            vol += tx.totalValue;
            count++;
        }
        if (!firstDate || txDate < firstDate) firstDate = txDate;

        if (tx.peerPK && tx.peerPK !== userPK && !tx.funding && !tx.withdrawal) {
            const txMs = txDate.getTime();
            if (!peerMap.has(tx.peerPK)) {
                peerMap.set(tx.peerPK, {
                    walletPK: tx.peerPK,
                    lastMs: 0,
                    stats: {
                        sent: 0,
                        received: 0,
                        net: 0,
                        vol: 0,
                        cnt: 0,
                    },
                });
            }
            const peer = peerMap.get(tx.peerPK);
            if (Number.isFinite(txMs) && txMs > (peer.lastMs || 0)) {
                peer.lastMs = txMs;
            }
            peer.stats.cnt++;
            peer.stats.vol += tx.totalValue;
            if (tx.incoming) {
                peer.stats.received += tx.totalValue;
                peer.stats.net += tx.totalValue;
            } else {
                peer.stats.sent += tx.totalValue;
                peer.stats.net -= tx.totalValue;
            }
            if (!peerTxsByPK.has(tx.peerPK)) {
                peerTxsByPK.set(tx.peerPK, []);
            }
            peerTxsByPK.get(tx.peerPK).push(tx);
        }

        const day = dayKey(txDate);
        const hour = dayHourKey(txDate);
        if (!dayMap.has(day)) dayMap.set(day, { net: 0, vol: 0, cnt: 0, txIds: [] });
        if (!hourMap.has(hour)) hourMap.set(hour, { net: 0, vol: 0, cnt: 0, txIds: [] });
        const dayBucket = dayMap.get(day);
        const hourBucket = hourMap.get(hour);
        dayBucket.net += tx.amount;
        dayBucket.vol += tx.totalValue;
        dayBucket.cnt++;
        dayBucket.txIds.push(tx.id);
        hourBucket.net += tx.amount;
        hourBucket.vol += tx.totalValue;
        hourBucket.cnt++;
        hourBucket.txIds.push(tx.id);
    }

    const sortedTxs = [...enrichedTxs].sort(byRecentTx);
    for (const txs of peerTxsByPK.values()) {
        txs.sort(byRecentTx);
    }

    return {
        dayMap,
        hourMap,
        peers: Object.fromEntries(peerMap),
        net,
        vol,
        firstDate,
        count,
        enrichedTxs,
        sortedTxs,
        txById,
        peerTxsByPK,
    };
};

const EMPTY_AGG = {
    dayMap: new Map(),
    hourMap: new Map(),
    peers: {},
    net: 0,
    vol: 0,
    firstDate: null,
    enrichedTxs: [],
    sortedTxs: [],
    txById: new Map(),
    peerTxsByPK: new Map(),
};

function getDailySeries({ days, transactions, aggregatedData, balance, historyComplete, oldestMs, cache }) {
    if (!transactions.length || balance == null) return [];
    const cacheKey = `daily-${days}`;
    if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const series = [];
    let runningBalance = Number(balance);
    const daysSinceFirst = aggregatedData.firstDate ? Math.ceil((today.getTime() - aggregatedData.firstDate.getTime()) / DAY_MS) : 0;
    const coveredDays = historyComplete ? days : coveredUnitsSince(oldestMs, DAY_MS, today.getTime());
    const actualDays = Math.min(days, daysSinceFirst + 1, coveredDays);

    for (let i = 0; i < actualDays; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = dayKey(d);
        series.push({ date: key, balance: runningBalance });
        const dayData = aggregatedData.dayMap.get(key);
        if (dayData) {
            runningBalance -= dayData.net;
        }
    }
    const result = series.reverse();
    cache.set(cacheKey, result);
    return result;
}

function getHourlySeriesForData({ hours, prefix = 'today', transactions, aggregatedData, balance, historyComplete, oldestMs, cache }) {
    if (!transactions.length || balance == null) return [];
    const cacheKey = `hourly-${hours}-${prefix}`;
    if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
    }
    const now = new Date();
    const series = [];
    let runningBalance = Number(balance);
    const today = dayKey(now);
    const yesterday = dayKey(new Date(now.getTime() - DAY_MS));
    const coveredHours = historyComplete ? hours : coveredUnitsSince(oldestMs, HOUR_MS, now.getTime());
    const actualHours = Math.min(hours, coveredHours);

    if (prefix === 'today') {
        const currentHour = now.getHours();
        const maxHour = Math.min(actualHours - 1, currentHour);
        for (let i = 0; i <= maxHour; i++) {
            const key = `${today}-${hourKey(i)}`;
            const hourData = aggregatedData.hourMap.get(key);
            if (hourData) {
                runningBalance -= hourData.net;
            }
        }
        for (let i = 0; i <= maxHour; i++) {
            const hour = hourKey(i);
            series.push({ hour, balance: runningBalance });
            const key = `${today}-${hour}`;
            const hourData = aggregatedData.hourMap.get(key);
            if (hourData) {
                runningBalance += hourData.net;
            }
        }
        series.push({ hour: 'now', balance: Number(balance) });
    } else if (prefix === '24h') {
        const currentHour = now.getHours();
        const firstOffset = Math.max(0, 24 - actualHours);
        for (let i = 0; i <= currentHour; i++) {
            const key = `${today}-${hourKey(i)}`;
            const hourData = aggregatedData.hourMap.get(key);
            if (hourData) runningBalance -= hourData.net;
        }
        for (let i = Math.max(currentHour + 1, firstOffset); i < 24; i++) {
            const key = `${yesterday}-${hourKey(i)}`;
            const hourData = aggregatedData.hourMap.get(key);
            if (hourData) runningBalance -= hourData.net;
        }
        for (let i = Math.max(currentHour + 1, firstOffset); i < 24; i++) {
            const hour = hourKey(i);
            series.push({ hour, balance: runningBalance });
            const key = `${yesterday}-${hour}`;
            const hourData = aggregatedData.hourMap.get(key);
            if (hourData) runningBalance += hourData.net;
        }
        for (let i = firstOffset > currentHour ? firstOffset : 0; i <= currentHour; i++) {
            const hour = hourKey(i);
            series.push({ hour, balance: runningBalance });
            const key = `${today}-${hour}`;
            const hourData = aggregatedData.hourMap.get(key);
            if (hourData) runningBalance += hourData.net;
        }
    }
    cache.set(cacheKey, series);
    return series;
}

function getTxsInRangeFrom(sortedTransactions, timeRange) {
    if (!sortedTransactions.length) return [];
    const cutoffMs = getTxRangeStartMs(timeRange);
    if (!Number.isFinite(cutoffMs)) {
        return sortedTransactions;
    }
    return sortedTransactions.filter((tx) => tx.createdMs >= cutoffMs);
}

export function createTxDataProvider({ useWallet, useUser, diag = null }) {
    if (typeof useWallet !== 'function' || typeof useUser !== 'function') {
        throw new Error('createTxDataProvider requires { useWallet, useUser }');
    }

    const TxDataContext = createContext(null);

    function TxDataProvider({ children }) {
        const {
            transfers,
            historyTransfers,
            balance,
            oldestTxMs,
            oldestKnownTxMs,
            oldestVerifiedTxMs,
            txHistoryComplete,
            txServerHistoryComplete,
            historyTransferCount,
            hasMoreTxs,
            isTxLoading,
            ensureTxCoverage,
            loadMoreTxs,
        } = useWallet();
        const { walletPK } = useUser();
        const seriesCache = useRef(new Map());
        const historySeriesCache = useRef(new Map());
        const lastTransfersRef = useRef(null);
        const lastHistoryTransfersRef = useRef(null);
        const lastBalanceRef = useRef(null);
        const historyAggregateRef = useRef({ transfers: null, walletPK: null, data: EMPTY_AGG });
        const aggregateDiagRef = useRef(null);

        const aggregatedData = useMemo(() => {
            const startedAt = Date.now();
            if (transfers !== lastTransfersRef.current) {
                seriesCache.current.clear();
                lastTransfersRef.current = transfers;
            }
            const r = walletPK && transfers?.length ? aggregateTxs(transfers, walletPK) : null;
            const nextAggregatedData = r ?? EMPTY_AGG;
            aggregateDiagRef.current = {
                elapsedMs: Date.now() - startedAt,
                transferCount: Array.isArray(transfers) ? transfers.length : 0,
                txCount: nextAggregatedData.sortedTxs.length,
                peerCount: Object.keys(nextAggregatedData.peers || {}).length,
                hasWalletPK: !!walletPK,
            };
            return nextAggregatedData;
        }, [transfers, walletPK]);

        useEffect(() => {
            if (!aggregateDiagRef.current) {
                return;
            }
            markDiag(diag, 'tx.provider.aggregate', aggregateDiagRef.current);
        }, [aggregatedData, diag]);

        const contextValue = useMemo(() => {
            if (balance !== lastBalanceRef.current) {
                seriesCache.current.clear();
                historySeriesCache.current.clear();
                lastBalanceRef.current = balance;
            }
            if (historyTransfers !== lastHistoryTransfersRef.current) {
                historySeriesCache.current.clear();
                lastHistoryTransfersRef.current = historyTransfers;
            }

            const transactions = aggregatedData.enrichedTxs;
            const sortedTransactions = aggregatedData.sortedTxs;
            const txHistoryKnownComplete = txHistoryComplete === true;
            const historyTxHistoryKnownComplete = txServerHistoryComplete === true || txHistoryKnownComplete;
            const historyOldestTxMs = Number.isFinite(oldestKnownTxMs) ? oldestKnownTxMs : oldestTxMs;
            const historyFirst = Number.isFinite(historyOldestTxMs) ? new Date(historyOldestTxMs).toISOString() : aggregatedData.firstDate ? aggregatedData.firstDate.toISOString() : null;

            const isTxRangeCovered = (timeRange) => {
                if (timeRange === 'all-time') return txHistoryKnownComplete;
                const startMs = getTxRangeStartMs(timeRange);
                if (!Number.isFinite(startMs)) return true;
                return txHistoryKnownComplete || (oldestTxMs != null && oldestTxMs <= startMs);
            };

            const isHistoryTxRangeCovered = (timeRange) => {
                if (timeRange === 'all-time') return historyTxHistoryKnownComplete;
                const startMs = getTxRangeStartMs(timeRange);
                if (!Number.isFinite(startMs)) return true;
                return historyTxHistoryKnownComplete || (historyOldestTxMs != null && historyOldestTxMs <= startMs);
            };

            const ensureTxRange = (timeRange) => {
                const startMs = getTxRangeStartMs(timeRange);
                return ensureTxCoverage?.(startMs);
            };

            const ensureHistoryTxRange = (timeRange) => {
                const startMs = getTxRangeStartMs(timeRange);
                return ensureTxCoverage?.(startMs, { publish: false, label: 'wallet.dashboardTxs' });
            };

            const getHistoryAggregatedData = () => {
                const source = Array.isArray(historyTransfers) && historyTransfers.length ? historyTransfers : transfers;
                if (source === transfers) {
                    return aggregatedData;
                }

                const cached = historyAggregateRef.current;
                if (cached.transfers === source && cached.walletPK === walletPK) {
                    return cached.data;
                }

                const data = walletPK && source?.length ? aggregateTxs(source, walletPK) : EMPTY_AGG;
                historyAggregateRef.current = { transfers: source, walletPK, data };
                return data;
            };

            const getDefaultTimeRange = () => {
                const historyTransactions = getHistoryAggregatedData().enrichedTxs;
                if (historyTxHistoryKnownComplete && historyTransactions.length) return 'all-time';
                for (const range of [30, 7, '24h', 'today']) {
                    if (isHistoryTxRangeCovered(range)) return range;
                }
                return 'today';
            };

            const getSeries = (days) => {
                return getDailySeries({ days, transactions, aggregatedData, balance, historyComplete: txHistoryKnownComplete, oldestMs: oldestTxMs, cache: seriesCache.current });
            };

            const getHourlySeries = (hours, prefix = 'today') => {
                return getHourlySeriesForData({ hours, prefix, transactions, aggregatedData, balance, historyComplete: txHistoryKnownComplete, oldestMs: oldestTxMs, cache: seriesCache.current });
            };

            const getTxsInRange = (timeRange) => {
                return getTxsInRangeFrom(sortedTransactions, timeRange);
            };

            const getHistorySeries = (days) => {
                const historyData = getHistoryAggregatedData();
                return getDailySeries({
                    days,
                    transactions: historyData.enrichedTxs,
                    aggregatedData: historyData,
                    balance,
                    historyComplete: historyTxHistoryKnownComplete,
                    oldestMs: historyOldestTxMs,
                    cache: historySeriesCache.current,
                });
            };

            const getHistoryHourlySeries = (hours, prefix = 'today') => {
                const historyData = getHistoryAggregatedData();
                return getHourlySeriesForData({
                    hours,
                    prefix,
                    transactions: historyData.enrichedTxs,
                    aggregatedData: historyData,
                    balance,
                    historyComplete: historyTxHistoryKnownComplete,
                    oldestMs: historyOldestTxMs,
                    cache: historySeriesCache.current,
                });
            };

            const getHistoryTxsInRange = (timeRange) => {
                const historyData = getHistoryAggregatedData();
                return getTxsInRangeFrom(historyData.sortedTxs, timeRange);
            };

            const getTxById = (txId) => aggregatedData.txById.get(txId) || null;
            const getPeerTxs = (peerPK) => {
                if (!peerPK) return [];
                return aggregatedData.peerTxsByPK.get(peerPK) || [];
            };
            const getPeerStats = (peerPK) => aggregatedData.peers?.[peerPK]?.stats ?? null;

            const getTxsForPeriod = (periodKey, isHourly = false) =>
                (aggregatedData[isHourly ? 'hourMap' : 'dayMap'].get(periodKey)?.txIds ?? []).map((id) => aggregatedData.txById.get(id)).filter(Boolean);

            return {
                getSeries,
                getHourlySeries,
                getTxsInRange,
                getHistorySeries,
                getHistoryHourlySeries,
                getHistoryTxsInRange,
                getTxById,
                getPeerTxs,
                getPeerStats,
                getTxsForPeriod,
                transactions,
                sortedTransactions,
                oldestTxMs,
                oldestKnownTxMs,
                oldestVerifiedTxMs,
                txHistoryComplete,
                txServerHistoryComplete,
                historyTransferCount,
                hasMoreTxs,
                isTxLoading,
                isTxRangeCovered,
                isHistoryTxRangeCovered,
                ensureTxRange,
                ensureHistoryTxRange,
                ensureTxCoverage,
                loadMoreTxs,
                getDefaultTimeRange,
                peers: aggregatedData.peers,
                net: aggregatedData.net,
                vol: aggregatedData.vol,
                first: aggregatedData.firstDate ? aggregatedData.firstDate.toISOString() : null,
                historyFirst,
                hasTx: transactions.length > 0,
            };
        }, [
            aggregatedData,
            balance,
            ensureTxCoverage,
            hasMoreTxs,
            historyTransferCount,
            historyTransfers,
            isTxLoading,
            loadMoreTxs,
            oldestKnownTxMs,
            oldestTxMs,
            oldestVerifiedTxMs,
            transfers,
            txHistoryComplete,
            txServerHistoryComplete,
            walletPK,
        ]);

        return <TxDataContext value={contextValue}>{children}</TxDataContext>;
    }

    const useTxData = () => useContext(TxDataContext);

    return { TxDataProvider, useTxData, TxDataContext };
}
