'use client';

import { createContext, useContext, useMemo, useRef } from 'react';

const formatDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const formatHour = (d) => String(d.getHours()).padStart(2, '0');

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
    let net = 0;
    let vol = 0;
    let firstDate = null;
    let count = 0;
    const enrichedTxs = [];

    for (const raw of transfers) {
        const tx = enrichTx(raw);
        if (!isValidTx(tx)) continue;
        enrichedTxs.push(tx);
        const txDate = new Date(tx.createdTime);

        if (!tx.funding) {
            net += tx.amount;
            vol += tx.totalValue;
            count++;
        }
        if (!firstDate || txDate < firstDate) firstDate = txDate;

        if (tx.peerPK && tx.peerPK !== userPK && !tx.funding && !tx.withdrawal) {
            if (!peerMap.has(tx.peerPK)) {
                peerMap.set(tx.peerPK, {
                    walletPK: tx.peerPK,
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
            peer.stats.cnt++;
            peer.stats.vol += tx.totalValue;
            if (tx.incoming) {
                peer.stats.received += tx.totalValue;
                peer.stats.net += tx.totalValue;
            } else {
                peer.stats.sent += tx.totalValue;
                peer.stats.net -= tx.totalValue;
            }
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

    return {
        dayMap,
        hourMap,
        peers: Object.fromEntries(peerMap),
        net,
        vol,
        firstDate,
        count,
        enrichedTxs,
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
};

export function createTxDataProvider({ useWallet, useUser }) {
    if (typeof useWallet !== 'function' || typeof useUser !== 'function') {
        throw new Error('createTxDataProvider requires { useWallet, useUser }');
    }

    const TxDataContext = createContext(null);

    function TxDataProvider({ children }) {
        const { transfers, balance } = useWallet();
        const { walletPK } = useUser();
        const seriesCache = useRef(new Map());
        const lastTransfersHash = useRef(null);

        const aggregatedData = useMemo(() => {
            const transfersHash = `${transfers?.length ?? 0}-${balance}`;
            if (transfersHash !== lastTransfersHash.current) {
                seriesCache.current.clear();
                lastTransfersHash.current = transfersHash;
            }
            const r = walletPK && transfers?.length ? aggregateTxs(transfers, walletPK) : null;
            return r ?? EMPTY_AGG;
        }, [transfers, walletPK, balance]);

        const contextValue = useMemo(() => {
            const transactions = aggregatedData.enrichedTxs;
            const completed = transactions.filter((tx) => !tx.pending);

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
                const actualDays = Math.min(days, daysSinceFirst + 1);

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

                if (prefix === 'today') {
                    const currentHour = now.getHours();
                    const maxHour = Math.min(hours - 1, currentHour);
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
                    for (let i = 0; i <= currentHour; i++) {
                        const hourKey = `${today}-${String(i).padStart(2, '0')}`;
                        const hourData = aggregatedData.hourMap.get(hourKey);
                        if (hourData) runningBalance -= hourData.net;
                    }
                    for (let i = currentHour + 1; i < 24; i++) {
                        const hourKey = `${yesterday}-${String(i).padStart(2, '0')}`;
                        const hourData = aggregatedData.hourMap.get(hourKey);
                        if (hourData) runningBalance -= hourData.net;
                    }
                    for (let i = currentHour + 1; i < 24; i++) {
                        series.push({ hour: String(i).padStart(2, '0'), balance: runningBalance });
                        const hourKey = `${yesterday}-${String(i).padStart(2, '0')}`;
                        const hourData = aggregatedData.hourMap.get(hourKey);
                        if (hourData) runningBalance += hourData.net;
                    }
                    for (let i = 0; i <= currentHour; i++) {
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
                    return transactions;
                }
                return transactions.filter((tx) => new Date(tx.createdTime) >= cutoffDate);
            };

            const getTxById = (txId) => transactions.find((tx) => tx.id === txId) || null;
            const getPeerTxs = (peerPK) => {
                if (!peerPK) return [];
                return transactions.filter((tx) => tx.peerPK === peerPK && !tx.funding && !tx.withdrawal);
            };
            const getPeerStats = (peerPK) => aggregatedData.peers?.[peerPK]?.stats ?? null;

            const getTxsForPeriod = (periodKey, isHourly = false) =>
                (aggregatedData[isHourly ? 'hourMap' : 'dayMap'].get(periodKey)?.txIds ?? []).map((id) => transactions.find((tx) => tx.id === id));

            return {
                getSeries,
                getHourlySeries,
                getTxsInRange,
                getTxById,
                getPeerTxs,
                getPeerStats,
                getTxsForPeriod,
                transactions,
                completed,
                peers: aggregatedData.peers,
                net: aggregatedData.net,
                vol: aggregatedData.vol,
                first: aggregatedData.firstDate ? aggregatedData.firstDate.toISOString() : null,
                hasTx: transactions.length > 0,
            };
        }, [aggregatedData, balance]);

        return <TxDataContext value={contextValue}>{children}</TxDataContext>;
    }

    const useTxData = () => useContext(TxDataContext);

    return { TxDataProvider, useTxData, TxDataContext };
}
