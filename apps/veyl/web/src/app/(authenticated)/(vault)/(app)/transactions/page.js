'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { formatUserDisplay, formatFullDateTime, renderMoney } from '@/lib/utils';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { listNavigationStep, loopListIndex } from '@/lib/focus';

const TX_ROW_HEIGHT = 60;
const TX_OVERSCAN_ROWS = 8;
const TX_FETCH_REMAINING = 25;

export default function TransactionsPage() {
    const { openDialog } = useDialog();
    const bitcoin = useBitcoin();
    const { txReady, hasMoreTxs, isTxLoading, loadMoreTxs } = useWallet();
    const user = useUser();
    const { settings } = user;
    const moneyFormat = settings.moneyFormat;
    const { sortedTransactions } = useTxData();
    const { peerByWalletPK } = usePeer();
    const { cloaked } = useCloak();
    const scrollRef = useRef(null);
    const rowRefs = useRef(new Map());
    const pendingFocusRef = useRef(null);
    const sorted = sortedTransactions || [];
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const visibleWindow = useMemo(() => {
        const start = Math.max(0, Math.floor(scrollTop / TX_ROW_HEIGHT) - TX_OVERSCAN_ROWS);
        const rowsInView = Math.ceil((viewportHeight || TX_ROW_HEIGHT) / TX_ROW_HEIGHT);
        const end = Math.min(sorted.length, start + rowsInView + TX_OVERSCAN_ROWS * 2);
        return { start, end };
    }, [scrollTop, sorted.length, viewportHeight]);
    const visibleTxs = useMemo(() => sorted.slice(visibleWindow.start, visibleWindow.end), [sorted, visibleWindow.end, visibleWindow.start]);

    const focusTxAtIndex = useCallback(
        (index) => {
            if (index < 0 || index >= sorted.length) {
                return false;
            }
            const row = rowRefs.current.get(index);
            if (!row?.focus) {
                pendingFocusRef.current = index;
                scrollRef.current?.scrollTo?.({ top: index * TX_ROW_HEIGHT });
                return true;
            }
            row.focus({ preventScroll: true });
            row.scrollIntoView?.({ block: 'nearest' });
            return true;
        },
        [sorted.length]
    );

    const stepTx = useCallback(
        (step) => {
            if (!sorted.length) {
                return false;
            }
            const active = typeof document === 'undefined' ? null : document.activeElement;
            let focusedIndex = -1;
            for (const [rowIndex, row] of rowRefs.current) {
                if (row && active && (row === active || row.contains(active))) {
                    focusedIndex = rowIndex;
                    break;
                }
            }
            const nextIndex = loopListIndex(sorted.length, focusedIndex, step);
            if (nextIndex === focusedIndex) {
                return true;
            }
            return focusTxAtIndex(nextIndex);
        },
        [focusTxAtIndex, sorted.length]
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

    useEffect(() => {
        const node = scrollRef.current;
        if (!node) return;
        const setHeight = () => setViewportHeight(node.clientHeight || 0);
        setHeight();
        if (typeof ResizeObserver !== 'function') {
            return;
        }
        const observer = new ResizeObserver(setHeight);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!hasMoreTxs || isTxLoading || sorted.length - visibleWindow.end > TX_FETCH_REMAINING) return;
        void loadMoreTxs?.();
    }, [hasMoreTxs, isTxLoading, loadMoreTxs, sorted.length, visibleWindow.end]);

    useEffect(() => {
        const index = pendingFocusRef.current;
        if (index == null || index < visibleWindow.start || index >= visibleWindow.end) return;
        pendingFocusRef.current = null;
        requestAnimationFrame(() => {
            const row = rowRefs.current.get(index);
            row?.focus?.({ preventScroll: true });
            row?.scrollIntoView?.({ block: 'nearest' });
        });
    }, [visibleWindow.end, visibleWindow.start, visibleTxs.length]);

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
                <div
                    ref={scrollRef}
                    className="h-full overflow-y-auto"
                    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                    onKeyDown={handleListKeyDown}
                >
                    <div className="relative" style={{ height: sorted.length * TX_ROW_HEIGHT }}>
                        {visibleTxs.map((tx, windowIndex) => {
                            const index = visibleWindow.start + windowIndex;
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
                                <div key={tx.id} className="absolute inset-x-0 border-b first:pt-px last:pb-px" style={{ top: index * TX_ROW_HEIGHT, height: TX_ROW_HEIGHT }}>
                                    <Button
                                        ref={(node) => {
                                            if (node) {
                                                rowRefs.current.set(index, node);
                                            } else {
                                                rowRefs.current.delete(index);
                                            }
                                        }}
                                        type="button"
                                        tabIndex={index === 0 ? 0 : -1}
                                        className="group h-full w-full justify-start rounded-none px-3 text-left"
                                        onClick={() => openDialog('txdetails', { tx })}
                                    >
                                        <div className="flex w-full items-center gap-2.5">
                                            <Avatar active={tx.funding || tx.withdrawal ? false : profile?.active} bot={!!profile?.bot} className="grower group-focus-visible:scale-120">
                                                <AvatarImage src={tx.funding || tx.withdrawal ? user?.avatar : profile?.avatar} alt={displayName} />
                                                <AvatarFallback />
                                            </Avatar>
                                            <span className={`${tx.funding ? 'text-inflow' : tx.withdrawal ? 'text-outflow' : ''} min-w-0 flex-1 truncate font-black leading-5`}>{displayName}</span>
                                            <div className="ml-auto flex min-w-0 shrink-0 flex-col items-end">
                                                <span className="whitespace-nowrap text-sm leading-4 text-muted">{tx.pending ? 'pending' : label}</span>
                                                <span className={`${isInflow ? 'text-inflow' : 'text-outflow'} mt-0.5 max-w-36 truncate text-right text-base leading-5 font-black ${tx.pending ? 'opacity-50' : ''} ${cloaked ? 'cloaked' : ''}`}>{formattedAmount}</span>
                                            </div>
                                        </div>
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </Card>
        </div>
    );
}
