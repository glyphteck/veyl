'use client';

import { useCallback, useRef } from 'react';
import Link from 'next/link';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { History } from 'lucide-react';
import { formatUserDisplay, formatFullDateTime, renderMoney } from '@/lib/utils';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { listNavigationStep, loopListIndex } from '@/lib/focus';

export function RecentTxList() {
    const { openDialog } = useDialog();
    const bitcoin = useBitcoin();
    const { txReady } = useWallet();
    const user = useUser();
    const { settings } = user;
    const moneyFormat = settings.moneyFormat;
    const { sortedTransactions } = useTxData();
    const { peerByWalletPK } = usePeer();
    const { cloaked } = useCloak();
    const rowRefs = useRef([]);
    const txsInRange = sortedTransactions || [];
    const maxTxs = 50;
    const recentTxs = txsInRange.slice(0, maxTxs);

    const hasMoreThanMax = recentTxs.length == maxTxs;
    const itemCount = recentTxs.length + (hasMoreThanMax ? 1 : 0);

    const focusTxAtIndex = useCallback(
        (index) => {
            if (index < 0 || index >= itemCount) {
                return false;
            }
            const row = rowRefs.current[index];
            if (!row?.focus) {
                return false;
            }
            row.focus({ preventScroll: true });
            row.scrollIntoView?.({ block: 'nearest' });
            return true;
        },
        [itemCount]
    );

    const stepTx = useCallback(
        (step) => {
            if (!itemCount) {
                return false;
            }
            const active = typeof document === 'undefined' ? null : document.activeElement;
            const focusedIndex = rowRefs.current.slice(0, itemCount).findIndex((row) => row && active && (row === active || row.contains(active)));
            const nextIndex = loopListIndex(itemCount, focusedIndex, step);
            if (nextIndex === focusedIndex) {
                return true;
            }
            return focusTxAtIndex(nextIndex);
        },
        [focusTxAtIndex, itemCount]
    );

    const handleListKeyDown = useCallback(
        (event) => {
            const step = listNavigationStep(event, { ignoreEditable: false });
            if (!step) return;
            if (stepTx(step)) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
        [stepTx]
    );

    if (!txReady || recentTxs.length === 0) {
        return (
            <Card>
                <div className="flex h-full items-center justify-center px-4 py-2">
                    <p className="text-2xl text-muted">{txReady ? 'no transactions yet' : 'loading transactions…'}</p>
                </div>
            </Card>
        );
    }
    return (
        <Card>
            <div className="overflow-y-auto" onKeyDown={handleListKeyDown}>
                <div className={`divide-y ${recentTxs.length < 12 ? 'border-b' : ''}`}>
                    {recentTxs.map((tx, index) => {
                        const label = formatFullDateTime(tx.createdTime);
                        const isInflow = tx.amount > 0;
                        const formattedAmount = renderMoney(tx.totalValue, moneyFormat, bitcoin.price, isInflow ? '+' : '-');
                        const profile = peerByWalletPK.get(tx.peerPK);
                        const displayName = tx.funding
                            ? 'Funded'
                            : tx.withdrawal
                              ? 'Withdrawn'
                              : formatUserDisplay({
                                    username: profile?.username,
                                    walletPK: tx.peerPK,
                                });

                        return (
                            <Button
                                key={tx.id}
                                ref={(node) => {
                                    rowRefs.current[index] = node;
                                }}
                                type="button"
                                tabIndex={index === 0 ? 0 : -1}
                                className="group h-15 w-full justify-start rounded-none px-3 text-left first:pt-px last:pb-px"
                                onClick={() => openDialog('txdetails', { tx })}
                            >
                                <div className="flex w-full items-center gap-2.5">
                                    <Avatar active={tx.funding || tx.withdrawal ? false : profile?.active} bot={!!profile?.bot} className="grower group-focus-visible:scale-120">
                                        <AvatarImage src={tx.funding || tx.withdrawal ? user?.avatar : profile?.avatar} alt={displayName} />
                                        <AvatarFallback />
                                    </Avatar>
                                    <span className={`${tx.funding ? 'text-inflow' : tx.withdrawal ? 'text-outflow' : ''} min-w-0 flex-1 truncate font-black leading-5`}>{displayName}</span>
                                    <div className="ml-auto flex min-w-0 shrink-0 flex-col items-end">
                                        <span className="whitespace-nowrap text-sm leading-4 font-black text-muted">{tx.pending ? 'pending' : label}</span>
                                        <span className={`${isInflow ? 'text-inflow' : 'text-outflow'} mt-0.5 max-w-36 truncate text-right text-base leading-5 font-black ${tx.pending ? 'opacity-50' : ''} ${cloaked ? 'cloaked' : ''}`}>{formattedAmount}</span>
                                    </div>
                                </div>
                            </Button>
                        );
                    })}
                    {hasMoreThanMax && (
                        <Button
                            asChild
                            ref={(node) => {
                                rowRefs.current[recentTxs.length] = node;
                            }}
                            tabIndex={-1}
                            className="group h-auto w-full justify-start rounded-none px-3 py-2 text-left"
                        >
                            <Link href="/transactions">
                                <History className="size-10 shrink-0 transition-transform group-hover:scale-120 group-focus-visible:scale-120 group-active:scale-85" />
                                <span className="text-xl">see all</span>
                            </Link>
                        </Button>
                    )}
                </div>
            </div>
        </Card>
    );
}
