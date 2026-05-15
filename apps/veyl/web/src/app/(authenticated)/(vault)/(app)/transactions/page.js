'use client';

import { useMemo } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Card } from '@/components/card';
import { formatUserDisplay, formatFullDateTime, renderMoney } from '@/lib/utils';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';

export default function TransactionsPage() {
    const { openDialog } = useDialog();
    const { bitcoin, txReady } = useWallet();
    const user = useUser();
    const { settings } = user;
    const moneyFormat = settings.moneyFormat;
    const { transactions } = useTxData();
    const { peers } = usePeer();
    const { cloaked } = useCloak();
    const txsInRange = transactions || [];
    const sorted = useMemo(() => [...txsInRange].sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime)), [txsInRange]);

    const peerMap = useMemo(() => {
        const map = new Map();
        peers?.forEach((peer) => {
            if (peer.walletPK) {
                map.set(peer.walletPK, peer);
            }
        });
        return map;
    }, [peers]);

    if (!txReady || sorted.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <Card className="w-full">
                    <div className="flex h-full items-center justify-center px-4 py-2">
                        <p className="text-2xl text-muted">{txReady ? 'no transactions yet' : 'loading transactions…'}</p>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="w-full h-full">
            <Card className="w-full h-full">
                <div className="h-full overflow-y-auto">
                    <div className={`divide-y ${sorted.length < 12 ? 'border-b' : ''}`}>
                        {sorted.map((tx) => {
                            const label = formatFullDateTime(tx.createdTime);
                            const isInflow = tx.amount > 0;
                            const formattedAmount = renderMoney(tx.totalValue, moneyFormat, bitcoin.price, isInflow ? '+' : '-');
                            const profile = peerMap.get(tx.peerPK);
                            const displayName = tx.funding
                                ? 'Funded'
                                : tx.withdrawal
                                  ? 'Withdrawn'
                                  : formatUserDisplay({
                                        username: profile?.username,
                                        walletPK: tx.peerPK,
                                    });

                            return (
                                <button key={tx.id} type="button" className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left" onClick={() => openDialog('txdetails', { tx })}>
                                    <div className="flex min-w-0 items-center gap-2.5 pr-4">
                                        <Avatar active={tx.funding || tx.withdrawal ? false : profile?.active} bot={!!profile?.bot} className="grower">
                                            <AvatarImage src={tx.funding || tx.withdrawal ? user?.avatar : profile?.avatar} alt={displayName} />
                                            <AvatarFallback />
                                        </Avatar>
                                        <span className={`${tx.funding ? 'font-black text-inflow' : tx.withdrawal ? 'font-black text-outflow' : ''} truncate`}>{displayName}</span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className={`${isInflow ? 'text-inflow' : 'text-outflow'} font-black ${tx.pending ? 'opacity-50' : ''} ${cloaked ? 'cloaked' : ''}`}>{formattedAmount}</span>
                                        <span className="whitespace-nowrap text-sm text-muted">{tx.pending ? 'pending' : label}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </Card>
        </div>
    );
}
