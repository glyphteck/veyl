'use client';

import { createContext, useContext, useMemo, useRef } from 'react';

const formatDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const formatHour = (d) => String(d.getHours()).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const timeMs = (value) => {
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : 0;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : 0;
    }
    if (Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : 0;
    }
    return 0;
};
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

const isValidTx = (tx) => {
    if (!tx.status) return true;
    return !['TRANSFER_STATUS_EXPIRED', 'TRANSFER_STATUS_RETURNED', 'UNRECOGNIZED'].includes(tx.status);
};

const enrichTx = (tx) => {
    const isStaticDeposit = tx.type === 'UTXO_SWAP' && tx.transferDirection === 'INCOMING';
    const incoming = tx.transferDirection === 'INCOMING';
    const isWithdrawal = tx.type === 'COOPERATIVE_EXIT';
    const isFunding = isStaticDeposit || tx.senderIdentityPublicKey === tx.receiverIdentityPublicKey || tx.type === 'BITCOIN_DEPOSIT';
    const peerPK = incoming ? tx.senderIdentityPublicKey : tx.receiverIdentityPublicKey;
    return {
        ...tx,
        createdMs: timeMs(tx.createdTime),
        incoming,
        peerPK,
        totalValue: tx.totalValue,
        amount: incoming ? tx.totalValue : -tx.totalValue,
        funding: isFunding,
        withdrawal: isWithdrawal,
        pending: tx.status !== 'TRANSFER_STATUS_COMPLETED',
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
        const tx = enrichTx(raw);
        if (!isValidTx(tx)) continue;
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

        const dayKey = formatDay(txDate);
        const hourKey = `${dayKey}-${formatHour(txDate)}`;
        if (!dayMap.has(dayKey)) dayMap.set(dayKey, { net: 0, vol: 0, cnt: 0, txIds: [] });
        if (!hourMap.has(hourKey)) hourMap.set(hourKey, { net: 0, vol: 0, cnt: 0, txIds: [] });
        const dayBucket = dayMap.get(dayKey);
        const hourBucket = hourMap.get(hourKey);
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

export function createTxDataProvider({ useWallet, useUser }) {
    if (typeof useWallet !== 'function' || typeof useUser !== 'function') {
        throw new Error('createTxDataProvider requires { useWallet, useUser }');
    }

    const TxDataContext = createContext(null);

    function TxDataProvider({ children }) {
        const { transfers, balance, oldestTxMs, txHistoryComplete, hasMoreTxs, isTxLoading, ensureTxCoverage, loadMoreTxs } = useWallet();
        const { walletPK } = useUser();
        const seriesCache = useRef(new Map());
        const lastTransfersRef = useRef(null);
        const lastBalanceRef = useRef(null);

        const aggregatedData = useMemo(() => {
            if (transfers !== lastTransfersRef.current || balance !== lastBalanceRef.current) {
                seriesCache.current.clear();
                lastTransfersRef.current = transfers;
                lastBalanceRef.current = balance;
            }
            const r = walletPK && transfers?.length ? aggregateTxs(transfers, walletPK) : null;
            return r ?? EMPTY_AGG;
        }, [transfers, walletPK, balance]);

        const contextValue = useMemo(() => {
            const transactions = aggregatedData.enrichedTxs;
            const sortedTransactions = aggregatedData.sortedTxs;

            const isTxRangeCovered = (timeRange) => {
                if (timeRange === 'all-time') return txHistoryComplete;
                const startMs = getTxRangeStartMs(timeRange);
                if (!Number.isFinite(startMs)) return true;
                return txHistoryComplete || (oldestTxMs != null && oldestTxMs <= startMs);
            };

            const ensureTxRange = (timeRange) => {
                const startMs = getTxRangeStartMs(timeRange);
                return ensureTxCoverage?.(startMs);
            };

            const getDefaultTimeRange = () => {
                if (txHistoryComplete && transactions.length) return 'all-time';
                for (const range of [30, 7, '24h', 'today']) {
                    if (isTxRangeCovered(range)) return range;
                }
                return 'today';
            };

            const getSeries = (days) => {
                if (!transactions.length || balance == null) return [];
                const cacheKey = `daily-${days}`;
                if (seriesCache.current.has(cacheKey)) {
                    return seriesCache.current.get(cacheKey);
                }
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const series = [];
                let runningBalance = Number(balance);
                const daysSinceFirst = aggregatedData.firstDate ? Math.ceil((today.getTime() - aggregatedData.firstDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
                const coveredDays = txHistoryComplete ? days : coveredUnitsSince(oldestTxMs, DAY_MS, today.getTime());
                const actualDays = Math.min(days, daysSinceFirst + 1, coveredDays);

                for (let i = 0; i < actualDays; i++) {
                    const d = new Date(today);
                    d.setDate(d.getDate() - i);
                    const key = formatDay(d);
                    series.push({ date: key, balance: runningBalance });
                    const dayData = aggregatedData.dayMap.get(key);
                    if (dayData) {
                        runningBalance -= dayData.net;
                    }
                }
                const result = series.reverse();
                seriesCache.current.set(cacheKey, result);
                return result;
            };

            const getHourlySeries = (hours, prefix = 'today') => {
                if (!transactions.length || balance == null) return [];
                const cacheKey = `hourly-${hours}-${prefix}`;
                if (seriesCache.current.has(cacheKey)) {
                    return seriesCache.current.get(cacheKey);
                }
                const now = new Date();
                const series = [];
                let runningBalance = Number(balance);
                const today = formatDay(now);
                const yesterday = formatDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
                const coveredHours = txHistoryComplete ? hours : coveredUnitsSince(oldestTxMs, HOUR_MS, now.getTime());
                const actualHours = Math.min(hours, coveredHours);

                if (prefix === 'today') {
                    const currentHour = now.getHours();
                    const maxHour = Math.min(actualHours - 1, currentHour);
                    for (let i = 0; i <= maxHour; i++) {
                        const hourKey = `${today}-${String(i).padStart(2, '0')}`;
                        const hourData = aggregatedData.hourMap.get(hourKey);
                        if (hourData) {
                            runningBalance -= hourData.net;
                        }
                    }
                    for (let i = 0; i <= maxHour; i++) {
                        series.push({ hour: String(i).padStart(2, '0'), balance: runningBalance });
                        const hourKey = `${today}-${String(i).padStart(2, '0')}`;
                        const hourData = aggregatedData.hourMap.get(hourKey);
                        if (hourData) {
                            runningBalance += hourData.net;
                        }
                    }
                    series.push({ hour: 'now', balance: Number(balance) });
                } else if (prefix === '24h') {
                    const currentHour = now.getHours();
                    const firstOffset = Math.max(0, 24 - actualHours);
                    for (let i = 0; i <= currentHour; i++) {
                        const hourKey = `${today}-${String(i).padStart(2, '0')}`;
                        const hourData = aggregatedData.hourMap.get(hourKey);
                        if (hourData) runningBalance -= hourData.net;
                    }
                    for (let i = Math.max(currentHour + 1, firstOffset); i < 24; i++) {
                        const hourKey = `${yesterday}-${String(i).padStart(2, '0')}`;
                        const hourData = aggregatedData.hourMap.get(hourKey);
                        if (hourData) runningBalance -= hourData.net;
                    }
                    for (let i = Math.max(currentHour + 1, firstOffset); i < 24; i++) {
                        series.push({ hour: String(i).padStart(2, '0'), balance: runningBalance });
                        const hourKey = `${yesterday}-${String(i).padStart(2, '0')}`;
                        const hourData = aggregatedData.hourMap.get(hourKey);
                        if (hourData) runningBalance += hourData.net;
                    }
                    for (let i = firstOffset > currentHour ? firstOffset : 0; i <= currentHour; i++) {
                        series.push({ hour: String(i).padStart(2, '0'), balance: runningBalance });
                        const hourKey = `${today}-${String(i).padStart(2, '0')}`;
                        const hourData = aggregatedData.hourMap.get(hourKey);
                        if (hourData) runningBalance += hourData.net;
                    }
                }
                seriesCache.current.set(cacheKey, series);
                return series;
            };

            const getTxsInRange = (timeRange) => {
                if (!transactions.length) return [];
                const now = new Date();
                let cutoffDate = new Date(now);
                if (timeRange === 'today') {
                    cutoffDate.setHours(0, 0, 0, 0);
                } else if (timeRange === '24h') {
                    cutoffDate.setTime(cutoffDate.getTime() - 24 * 60 * 60 * 1000);
                } else if (typeof timeRange === 'number') {
                    cutoffDate.setDate(cutoffDate.getDate() - timeRange);
                } else {
                    return sortedTransactions;
                }
                const cutoffMs = cutoffDate.getTime();
                return sortedTransactions.filter((tx) => tx.createdMs >= cutoffMs);
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
                getTxById,
                getPeerTxs,
                getPeerStats,
                getTxsForPeriod,
                transactions,
                sortedTransactions,
                oldestTxMs,
                txHistoryComplete,
                hasMoreTxs,
                isTxLoading,
                isTxRangeCovered,
                ensureTxRange,
                ensureTxCoverage,
                loadMoreTxs,
                getDefaultTimeRange,
                peers: aggregatedData.peers,
                net: aggregatedData.net,
                vol: aggregatedData.vol,
                first: aggregatedData.firstDate ? aggregatedData.firstDate.toISOString() : null,
                hasTx: transactions.length > 0,
            };
        }, [aggregatedData, balance, ensureTxCoverage, hasMoreTxs, isTxLoading, loadMoreTxs, oldestTxMs, txHistoryComplete]);

        return <TxDataContext value={contextValue}>{children}</TxDataContext>;
    }

    const useTxData = () => useContext(TxDataContext);

    return { TxDataProvider, useTxData, TxDataContext };
}
