'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { formatUserDisplay } from '@veyl/shared/profile';
import { renderMoney } from '@veyl/shared/money';
import { formatFullDateTime, formatRowDateTime } from '@veyl/shared/utils/time';
import { useRowDateTimeNow } from '@veyl/shared/utils/userowdatetime';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { getInsertedRowBatch, sameListIds } from '@veyl/shared/chat/listanimation';
import { listNavigationStep, loopListIndex } from '@/lib/focus';
import { cn } from '@/lib/classes';
import rowMotion from '@/components/listrowmotion.module.css';

const TX_ROW_APPEAR_MS = 320;
const TX_ROW_APPEAR_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const MAX_TX_ANIMATED_INSERTS = 8;
const TX_INITIAL_RENDER_LIMIT = 80;
const TX_RENDER_BATCH_SIZE = 60;
const TX_SCROLL_LOAD_PX = 180;

function getTxIds(txs) {
    return (txs || []).map((tx) => tx?.id).filter(Boolean);
}

function sameTxRow(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
        a.id === b.id &&
        a.pending === b.pending &&
        a.amount === b.amount &&
        a.totalValue === b.totalValue &&
        a.createdMs === b.createdMs &&
        a.peerPK === b.peerPK &&
        a.funding === b.funding &&
        a.withdrawal === b.withdrawal
    );
}

function sameProfile(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.username === b.username && a.avatar === b.avatar && a.active === b.active && a.bot === b.bot;
}

function useRecentTxAnimation(recentTxs) {
    const [displayTxs, setDisplayTxs] = useState(recentTxs);
    const [insertingIds, setInsertingIds] = useState(() => new Set());
    const displayRef = useRef(recentTxs);
    const pendingRef = useRef(null);
    const animatingRef = useRef(false);
    const timerRef = useRef(null);
    const applyRef = useRef(null);

    const clearTimer = useCallback(() => {
        if (!timerRef.current) return;
        clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const startInsert = useCallback(
        (nextTxs, batch) => {
            clearTimer();
            animatingRef.current = true;
            displayRef.current = nextTxs;
            setDisplayTxs(nextTxs);
            setInsertingIds(new Set(batch.ids));
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                animatingRef.current = false;
                setInsertingIds(new Set());

                const pending = pendingRef.current;
                pendingRef.current = null;
                if (pending) {
                    applyRef.current?.(pending);
                }
            }, TX_ROW_APPEAR_MS);
        },
        [clearTimer]
    );

    const applyTxs = useCallback(
        (nextTxs) => {
            const previousIds = getTxIds(displayRef.current);
            const nextIds = getTxIds(nextTxs);
            if (sameListIds(previousIds, nextIds)) {
                if (displayRef.current !== nextTxs) {
                    displayRef.current = nextTxs;
                    setDisplayTxs(nextTxs);
                }
                return;
            }

            const insertBatch = getInsertedRowBatch(previousIds, nextIds);
            if (insertBatch && insertBatch.ids.length <= MAX_TX_ANIMATED_INSERTS) {
                startInsert(nextTxs, insertBatch);
                return;
            }

            displayRef.current = nextTxs;
            setDisplayTxs(nextTxs);
            setInsertingIds(new Set());
        },
        [startInsert]
    );

    useEffect(() => {
        applyRef.current = applyTxs;
    }, [applyTxs]);

    useEffect(() => {
        if (animatingRef.current) {
            pendingRef.current = recentTxs;
            return;
        }
        applyTxs(recentTxs);
    }, [applyTxs, recentTxs]);

    useEffect(
        () => () => {
            clearTimer();
        },
        [clearTimer]
    );

    return { displayTxs, insertingIds };
}

const RecentTxRow = memo(function RecentTxRow({ bitcoinPrice, cloaked, isFirst, isLast, moneyFormat, onOpenTx, profile, rowNow, rowRefs, tx, user }) {
    const exactLabel = formatFullDateTime(tx.createdTime);
    const label = formatRowDateTime(tx.createdTime, rowNow);
    const isInflow = tx.amount > 0;
    const formattedAmount = renderMoney(tx.totalValue, moneyFormat, bitcoinPrice, isInflow ? '+' : '-');
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
            ref={(node) => {
                if (node) {
                    rowRefs.current.set(tx.id, node);
                } else {
                    rowRefs.current.delete(tx.id);
                }
            }}
            type="button"
            tabIndex={isFirst ? 0 : -1}
            className={`group h-15 w-full justify-start rounded-none px-3 text-left ${isFirst ? 'pt-px' : ''} ${isLast ? 'pb-px' : ''}`}
            onClick={() => onOpenTx(tx)}
            title={exactLabel || undefined}
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
}, (prev, next) =>
    prev.bitcoinPrice === next.bitcoinPrice &&
    prev.cloaked === next.cloaked &&
    prev.isFirst === next.isFirst &&
    prev.isLast === next.isLast &&
    prev.moneyFormat === next.moneyFormat &&
    prev.onOpenTx === next.onOpenTx &&
    prev.rowNow === next.rowNow &&
    prev.user?.avatar === next.user?.avatar &&
    sameTxRow(prev.tx, next.tx) &&
    sameProfile(prev.profile, next.profile)
);

export function RecentTxList() {
    const { openDialog } = useDialog();
    const bitcoin = useBitcoin();
    const { hasMoreTxs, isTxLoading, loadMoreTxs, txReady } = useWallet();
    const user = useUser();
    const { settings } = user;
    const moneyFormat = settings.moneyFormat;
    const { getHistoryTxsInRange, sortedTransactions } = useTxData();
    const { peerByWalletPK } = usePeer();
    const { cloaked } = useCloak();
    const scrollRef = useRef(null);
    const rowRefs = useRef(new Map());
    const loadingMoreRef = useRef(false);
    const publishedTxs = sortedTransactions || [];
    const historyTxs = useMemo(() => getHistoryTxsInRange?.('all-time') || [], [getHistoryTxsInRange]);
    const txs = historyTxs.length >= publishedTxs.length ? historyTxs : publishedTxs;
    const { displayTxs, insertingIds } = useRecentTxAnimation(txs);
    const [visibleLimit, setVisibleLimit] = useState(0);

    const visibleTxs = useMemo(() => displayTxs.slice(0, Math.min(visibleLimit, displayTxs.length)), [displayTxs, visibleLimit]);
    const visibleTxIds = useMemo(() => visibleTxs.map((tx) => tx.id), [visibleTxs]);
    const visibleTxTimes = useMemo(() => visibleTxs.map((tx) => tx.createdTime), [visibleTxs]);
    const rowNow = useRowDateTimeNow(visibleTxTimes);
    const hasHiddenRenderedTxs = visibleLimit < displayTxs.length;
    const itemCount = visibleTxs.length;
    const openTx = useCallback((tx) => openDialog('txdetails', { tx }), [openDialog]);

    const focusTxAtIndex = useCallback(
        (index) => {
            if (index < 0 || index >= itemCount) {
                return false;
            }
            const row = rowRefs.current.get(visibleTxIds[index]);
            if (!row?.focus) {
                return false;
            }
            row.focus({ preventScroll: true });
            row.scrollIntoView?.({ block: 'nearest' });
            return true;
        },
        [itemCount, visibleTxIds]
    );

    const stepTx = useCallback(
        (step) => {
            if (!itemCount) {
                return false;
            }
            const active = typeof document === 'undefined' ? null : document.activeElement;
            const focusedIndex = visibleTxIds.findIndex((id) => {
                const row = rowRefs.current.get(id);
                return row && active && (row === active || row.contains(active));
            });
            const nextIndex = loopListIndex(itemCount, focusedIndex, step);
            if (nextIndex === focusedIndex) {
                return true;
            }
            return focusTxAtIndex(nextIndex);
        },
        [focusTxAtIndex, itemCount, visibleTxIds]
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
        if (!isTxLoading) {
            loadingMoreRef.current = false;
        }
    }, [isTxLoading]);

    useEffect(() => {
        setVisibleLimit((current) => {
            if (!displayTxs.length) {
                return 0;
            }
            if (current <= 0) {
                return Math.min(displayTxs.length, TX_INITIAL_RENDER_LIMIT);
            }
            return Math.min(current, displayTxs.length);
        });
    }, [displayTxs.length]);

    const loadMore = useCallback(() => {
        if (hasHiddenRenderedTxs) {
            setVisibleLimit((current) => Math.min(displayTxs.length, Math.max(current, TX_INITIAL_RENDER_LIMIT) + TX_RENDER_BATCH_SIZE));
            return;
        }
        if (!hasMoreTxs || isTxLoading || loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        const request = loadMoreTxs?.();
        Promise.resolve(request).finally(() => {
            loadingMoreRef.current = false;
        });
    }, [displayTxs.length, hasHiddenRenderedTxs, hasMoreTxs, isTxLoading, loadMoreTxs]);

    const handleScroll = useCallback(
        (event) => {
            const node = event.currentTarget;
            if (node.scrollHeight - node.scrollTop - node.clientHeight <= TX_SCROLL_LOAD_PX) {
                loadMore();
            }
        },
        [loadMore]
    );

    useEffect(() => {
        const node = scrollRef.current;
        if (!node || !txReady || (!hasHiddenRenderedTxs && !hasMoreTxs) || isTxLoading) return;
        if (node.scrollHeight <= node.clientHeight + 4) {
            loadMore();
        }
    }, [hasHiddenRenderedTxs, hasMoreTxs, isTxLoading, loadMore, txReady, visibleTxs.length]);

    if (!txReady || displayTxs.length === 0) {
        return (
            <Card>
                <div className="flex h-full items-center justify-center px-4 py-2">
                    <p className="text-2xl text-muted">{txReady ? 'no transactions yet' : 'loading transactions…'}</p>
                </div>
            </Card>
        );
    }
    return (
        <Card style={{ '--row-motion-duration': `${TX_ROW_APPEAR_MS}ms`, '--row-motion-ease': TX_ROW_APPEAR_EASE }}>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onKeyDown={handleListKeyDown} onScroll={handleScroll}>
                <div className={`divide-y ${visibleTxs.length < 12 ? 'border-b' : ''}`}>
                    {visibleTxs.map((tx, index) => {
                        const entering = insertingIds.has(tx.id);
                        return (
                            <div key={tx.id} className={cn(rowMotion.row, entering && rowMotion.entering)}>
                                <div className={entering ? rowMotion.content : ''}>
                                    <RecentTxRow
                                        bitcoinPrice={bitcoin.price}
                                        cloaked={cloaked}
                                        isFirst={index === 0}
                                        isLast={index === visibleTxs.length - 1}
                                    moneyFormat={moneyFormat}
                                    onOpenTx={openTx}
                                    profile={peerByWalletPK.get(tx.peerPK)}
                                    rowNow={rowNow}
                                    rowRefs={rowRefs}
                                        tx={tx}
                                        user={user}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Card>
    );
}
