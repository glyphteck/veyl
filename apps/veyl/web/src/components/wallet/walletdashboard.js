import { useState, useMemo, useEffect } from 'react';
import { Card } from '@/components/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { ToggleGroup, ToggleGroupItem } from '@/components/togglegroup';
import { BalanceChart } from '@/components/wallet/charts/balance';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { formatToUSD } from '@glyphteck/shared/formatmoney';
import { formatUserDisplay, renderBalance, renderMoney, renderNet } from '@/lib/utils';

function renderBalanceDescription(amount, moneyFormat, price) {
    if (amount == null) return '—';
    const primary = renderBalance(amount, moneyFormat, price);
    if (primary.includes('sat')) return formatToUSD(amount, price, { fallbackToSats: false });
    return renderMoney(amount, 'sats', price);
}

export function WalletDashboard() {
    const { balance, bitcoin } = useWallet();
    const { settings } = useUser();
    const { getSeries, getHourlySeries, getTxsInRange, first, transactions } = useTxData();
    const { peers } = usePeer();
    const { openDialog } = useDialog();
    const { cloaked } = useCloak();
    const moneyFormat = settings.moneyFormat;
    const [timeRange, setTimeRange] = useState('all-time');
    const balanceDescription = renderBalanceDescription(balance, moneyFormat, bitcoin.price);

    const { chartData, filteredTxs, percentChange } = useMemo(() => {
        if (!getSeries || !getHourlySeries || !getTxsInRange) return { chartData: [], filteredTxs: [], percentChange: 0 };

        const chartData = (() => {
            if (timeRange === 'today') return getHourlySeries(24, 'today');
            if (timeRange === '24h') return getHourlySeries(24, '24h');
            if (timeRange === 'all-time') {
                const daysSinceFirst = first ? Math.ceil((Date.now() - new Date(first).getTime()) / (1000 * 60 * 60 * 24)) + 1 : 1;
                return getSeries(daysSinceFirst);
            }
            return getSeries(Number(timeRange));
        })();

        // get % change
        let percentChange = 0;
        if (chartData.length >= 2) {
            const startBalance = chartData[0].balance;
            const endBalance = chartData[chartData.length - 1].balance;
            if (startBalance !== 0) {
                percentChange = ((endBalance - startBalance) / Math.abs(startBalance)) * 100;
            }
        }
        const filteredTxs = getTxsInRange(timeRange);
        return { chartData, filteredTxs, percentChange };
    }, [getSeries, getHourlySeries, getTxsInRange, timeRange, first]);

    const netTotal = filteredTxs.reduce((sum, tx) => sum + (tx.incoming ? tx.totalValue : -tx.totalValue), 0);
    const nonFundingTxs = filteredTxs.filter((tx) => !tx.funding);
    const txCount = nonFundingTxs.length;
    const volume = nonFundingTxs.reduce((sum, tx) => sum + tx.totalValue, 0);
    const avgTxSize = txCount > 0 ? Math.round(volume / txCount) : 0;

    let avgDailyVolume = 0;
    if (timeRange === 'today' || timeRange === '24h') {
        avgDailyVolume = Math.round(volume / 24);
    } else if (timeRange === 'all-time') {
        const firstTxDate = first ? new Date(first) : null;
        if (firstTxDate) {
            const daysSinceFirst = Math.max(1, Math.ceil((Date.now() - firstTxDate.getTime()) / (1000 * 60 * 60 * 24)));
            avgDailyVolume = Math.round(volume / daysSinceFirst);
        }
    } else if (timeRange > 0) {
        avgDailyVolume = Math.round(volume / timeRange);
    }
    let topPeers = [];
    if (filteredTxs.length > 0) {
        const peerStats = new Map();
        filteredTxs.forEach((tx) => {
            if (!tx.peerPK || tx.funding || tx.withdrawal) return;
            if (!peerStats.has(tx.peerPK)) peerStats.set(tx.peerPK, { vol: 0, net: 0, cnt: 0 });
            const stats = peerStats.get(tx.peerPK);
            stats.vol += tx.totalValue;
            stats.net += tx.incoming ? tx.totalValue : -tx.totalValue;
            stats.cnt += 1;
        });

        const topPeerPKs = Array.from(peerStats.entries())
            .sort(([, a], [, b]) => b.vol - a.vol)
            .slice(0, 10);
        // add profile data and store period stats separately
        topPeers = topPeerPKs.map(([walletPK, periodStats]) => {
            const profile = peers?.find((peer) => peer.walletPK === walletPK);
            return {
                ...profile,
                walletPK,
                periodStats,
            };
        });
    }

    // get avaialble time ranges
    const availableTimeRanges = useMemo(() => {
        if (!transactions || !first) return ['today'];
        const now = new Date();
        const firstTxDate = new Date(first);
        const daysSinceFirst = Math.floor((now.setHours(0, 0, 0, 0) - firstTxDate.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
        const hoursSinceFirst = Math.floor((Date.now() - new Date(first).getTime()) / (1000 * 60 * 60));
        const ranges = [];
        if (transactions.length > 0) ranges.push('today');
        if (hoursSinceFirst >= 24) ranges.push('24h');
        if (daysSinceFirst >= 7) ranges.push(7);
        if (daysSinceFirst >= 30) ranges.push(30);
        if (daysSinceFirst >= 90) ranges.push(90);
        if (daysSinceFirst >= 180) ranges.push(180);
        if (daysSinceFirst >= 365) ranges.push(365);
        if (daysSinceFirst >= 1) ranges.push('all-time');
        return ranges.length ? ranges : ['today'];
    }, [transactions, first]);

    useEffect(() => {
        if (availableTimeRanges.length > 0 && !availableTimeRanges.includes(timeRange)) {
            setTimeRange(availableTimeRanges[0]);
        }
    }, [availableTimeRanges, timeRange]);

    const timeRangeOptions = [
        availableTimeRanges.includes('today') && { value: 'today', label: 'today' },
        availableTimeRanges.includes('24h') && { value: '24h', label: '24h', title: '24 hours' },
        availableTimeRanges.includes(7) && { value: '7', label: '7d', title: '7 days' },
        availableTimeRanges.includes(30) && { value: '30', label: '30d', title: '30 days' },
        availableTimeRanges.includes(90) && { value: '90', label: '3m', title: '3 months' },
        availableTimeRanges.includes(180) && { value: '180', label: '6m', title: '6 months' },
        availableTimeRanges.includes(365) && { value: '365', label: '1y', title: '1 year' },
        availableTimeRanges.includes('all-time') && { value: 'all-time', label: 'all', title: 'all time' },
    ].filter(Boolean);

    return (
        <div className="flex flex-col gap-2 h-full min-h-0">
            <Card className="flex-1 min-h-0">
                <div className="flex items-start gap-4 px-6 pt-4">
                    <div className="group flex min-w-0 flex-1 items-end gap-2">
                        <div className={`text-7xl leading-none font-black ${cloaked ? 'cloaked' : ''}`}>
                            <span>{balance === null ? '—' : renderBalance(balance, moneyFormat, bitcoin.price)}</span>
                        </div>
                        {balance !== 0 && percentChange !== 0 && Math.abs(percentChange) >= 1 ? (
                            <div className="relative">
                                <div className="text-lg text-muted transition-opacity group-hover:opacity-0">
                                    {(() => {
                                        if (!isFinite(percentChange)) return 'new balance since ';
                                        const multiplier = percentChange / 100 + 1;
                                        if (Math.abs(percentChange) > 1000) return `x${Math.round(multiplier)} since `;
                                        if (Math.abs(percentChange) > 200) return `x${multiplier.toFixed(2)} since `;
                                        if (Math.abs(percentChange) < 10) return `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(2)}% from `;
                                        return `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(0)}% from `;
                                    })()}
                                    {timeRange === 'today'
                                        ? 'midnight'
                                        : timeRange === '24h'
                                          ? 'yesterday'
                                          : timeRange === 7
                                            ? 'last week'
                                            : timeRange === 30
                                              ? 'last month'
                                              : timeRange === 90
                                                ? 'last 3 months'
                                                : timeRange === 180
                                                  ? 'last 6 months'
                                                  : timeRange === 365
                                                    ? 'last year'
                                                    : timeRange === 'all-time'
                                                      ? 'first day'
                                                      : ''}
                                </div>
                                <div className={`absolute inset-0 text-lg text-muted opacity-0 transition-opacity group-hover:opacity-100 ${cloaked ? 'cloaked' : ''}`}>{balanceDescription}</div>
                            </div>
                        ) : (
                            <div className={`text-lg text-muted ${cloaked ? 'cloaked' : ''}`}>{balanceDescription}</div>
                        )}
                    </div>
                    {availableTimeRanges.length > 1 && (
                        <ToggleGroup
                            aria-label="select a time range"
                            className="ml-auto self-center shrink-0"
                            type="single"
                            value={String(timeRange)}
                            onValueChange={(next) => {
                                if (!next) return;
                                setTimeRange(['7', '30', '90', '180', '365'].includes(next) ? Number(next) : next);
                            }}
                            required
                        >
                            {timeRangeOptions.map((option) => (
                                <ToggleGroupItem key={option.value} value={option.value} aria-label={option.title || option.label} title={option.title || option.label} className="px-3 text-sm">
                                    {option.label}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    )}
                </div>
                <div className="w-full h-full min-h-0 overflow-visible px-4 py-2">
                    <BalanceChart data={chartData} timeRange={timeRange} moneyFormat={moneyFormat} bitcoin={bitcoin} className="min-h-0" />
                </div>
            </Card>
            <div className="grid grid-cols-2 gap-2 ">
                <div className="flex flex-col gap-2">
                    <Card>
                        <div className="px-4 pt-2 text-2xl leading-none font-black">net total</div>
                        <div className="flex h-full flex-col justify-end px-4 py-2">
                            <div className={`text-5xl font-black ${netTotal > 0 ? 'text-inflow' : netTotal < 0 ? 'text-outflow' : ''} ${cloaked ? 'cloaked' : ''}`}>
                                {filteredTxs.length === 0 ? '∅' : renderMoney(netTotal, moneyFormat, bitcoin.price)}
                            </div>
                        </div>
                    </Card>
                    <Card>
                        <div className="flex items-center justify-between gap-2 px-4 pt-2">
                            <div className="text-2xl leading-none font-black">volume</div>
                            <div className={`text-muted whitespace-nowrap shrink-0 overflow-hidden text-sm ${cloaked ? 'cloaked' : ''}`}>
                                {avgDailyVolume > 0 && txCount >= 1 ? renderMoney(avgDailyVolume, moneyFormat, bitcoin.price, '~') : ''}
                                {avgDailyVolume > 0 && txCount >= 1
                                    ? timeRange === 'today' || timeRange === '24h'
                                        ? '/hour'
                                        : '/day'
                                    : volume === 0
                                      ? 'no data yet'
                                      : txCount === 1
                                        ? ''
                                        : 'no volume'}
                            </div>
                        </div>
                        <div className="flex h-full flex-col justify-end px-4 py-2">
                            <div className={`text-5xl font-black ${cloaked ? 'cloaked' : ''}`}>{volume === 0 ? '∅' : renderMoney(volume, moneyFormat, bitcoin.price)}</div>
                        </div>
                    </Card>
                </div>
                {/* top peers */}
                <Card className="flex flex-col min-h-0 h-60.75">
                    <div className="flex-1 overflow-y-auto">
                        {topPeers.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-muted text-sm">no data yet</div>
                            </div>
                        ) : (
                            <div className={`divide-y ${topPeers.length < 4 ? 'border-b' : ''}`}>
                                {topPeers.map((peer) => {
                                    const peerId = peer.walletPK;
                                    return (
                                        <button
                                            key={peerId}
                                            type="button"
                                            className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left"
                                            onClick={() => openDialog('userdetails', { user: peer })}
                                        >
                                            <div className="flex min-w-0 items-center gap-2.5 pr-4">
                                                <Avatar active={peer?.active} bot={!!peer?.bot} className="grower">
                                                    <AvatarImage src={peer.avatar} />
                                                    <AvatarFallback />
                                                </Avatar>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate">{formatUserDisplay({ username: peer.username, sparkAddress: peer.sparkAddress, walletPK: peer.walletPK })}</div>
                                                    <div className="text-sm text-muted">
                                                        {peer.periodStats?.cnt || 0} tx{(peer.periodStats?.cnt || 0) !== 1 ? 's' : ''}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <div
                                                    className={`font-black ${(peer.periodStats?.net || 0) < 0 ? 'text-outflow' : (peer.periodStats?.net || 0) > 0 ? 'text-inflow' : ''} ${cloaked ? 'cloaked' : ''}`}
                                                >
                                                    {renderNet(peer.periodStats?.net || 0, moneyFormat, bitcoin.price)}
                                                </div>
                                                <div className={`text-sm text-muted ${cloaked ? 'cloaked' : ''}`}>{renderMoney(peer.periodStats?.vol || 0, moneyFormat, bitcoin.price)}</div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </Card>
            </div>
        </div>
    );
}
