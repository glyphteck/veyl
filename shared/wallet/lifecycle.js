import { useCallback, useEffect, useRef } from 'react';

import {
    WALLET_ACTIVE_CLAIM_POLL_MS,
    WALLET_BALANCE_EVENT_COALESCE_MS,
    WALLET_INCOMING_UPDATE_COALESCE_MS,
    WALLET_TRANSFER_POLL_MS,
} from '../config.js';
import { markDiag, markDone } from '../utils/diagnostics.js';

const POLL_TXS_RATE = WALLET_TRANSFER_POLL_MS;
const ACTIVE_CLAIM_RATE = WALLET_ACTIVE_CLAIM_POLL_MS;
const BALANCE_EVENT_COALESCE_MS = WALLET_BALANCE_EVENT_COALESCE_MS;
const INCOMING_UPDATE_COALESCE_MS = WALLET_INCOMING_UPDATE_COALESCE_MS;
const WALLET_EVENTS = Object.freeze({
    balance: 'balance:update',
    tokenBalance: 'token-balance:update',
    transferClaimed: 'transfer:claimed',
    depositConfirmed: 'deposit:confirmed',
});

function clearTimer(ref) {
    if (!ref.current) {
        return;
    }
    clearInterval(ref.current);
    ref.current = null;
}

function walletUpdateRequest(request = {}) {
    const normalized = request && typeof request === 'object' ? request : {};
    return {
        force: normalized.force === true,
        balance: normalized.balance !== false,
        transfers: normalized.transfers !== false,
        reason: normalized.reason || 'manual',
    };
}

function mergeWalletUpdateRequest(current, next) {
    if (!current) {
        return next;
    }

    return {
        force: current.force || next.force,
        balance: current.balance || next.balance,
        transfers: current.transfers || next.transfers,
        reason: current.reason === next.reason ? current.reason : 'merged',
    };
}

export function useWalletData({ wallet, getBalance, getRecentTxs, diag }) {
    const updatePromiseRef = useRef(null);
    const queuedRequestRef = useRef(null);

    return useCallback(
        async (requestOptions = {}) => {
            if (!wallet) {
                return;
            }

            const request = walletUpdateRequest(requestOptions);
            if (!request.balance && !request.transfers) {
                return;
            }

            if (updatePromiseRef.current) {
                queuedRequestRef.current = mergeWalletUpdateRequest(queuedRequestRef.current, request);
                markDiag(diag, 'wallet.update.join', {
                    force: request.force,
                    reason: request.reason,
                    queuedForce: queuedRequestRef.current.force,
                    queuedBalance: queuedRequestRef.current.balance,
                    queuedTransfers: queuedRequestRef.current.transfers,
                    queuedReason: queuedRequestRef.current.reason,
                });
                return updatePromiseRef.current;
            }

            const run = async () => {
                let currentRequest = request;

                while (currentRequest) {
                    const startedAt = Date.now();
                    markDiag(diag, 'wallet.update.start', {
                        force: currentRequest.force,
                        reason: currentRequest.reason,
                        balance: currentRequest.balance,
                        transfers: currentRequest.transfers,
                    });
                    const tasks = [];
                    if (currentRequest.balance) {
                        tasks.push(getBalance());
                    }
                    if (currentRequest.transfers) {
                        tasks.push(getRecentTxs());
                    }
                    await Promise.all(tasks);
                    markDone(diag, 'wallet.update', startedAt, {
                        force: currentRequest.force,
                        reason: currentRequest.reason,
                        balance: currentRequest.balance,
                        transfers: currentRequest.transfers,
                    });

                    currentRequest = queuedRequestRef.current;
                    queuedRequestRef.current = null;
                    if (currentRequest) {
                        markDiag(diag, 'wallet.update.drain', {
                            force: currentRequest.force,
                            reason: currentRequest.reason,
                            balance: currentRequest.balance,
                            transfers: currentRequest.transfers,
                        });
                    }
                }
            };

            updatePromiseRef.current = run().finally(() => {
                updatePromiseRef.current = null;
            });
            return updatePromiseRef.current;
        },
        [diag, wallet, getBalance, getRecentTxs]
    );
}

export function useWalletEvents({ wallet, updateWalletData, rememberTransfer, setBalance, setTokenBalances, setSatsBalanceResult, diag }) {
    const balanceEventRef = useRef({ timer: null, value: null });
    const incomingEventRef = useRef({ timer: null, balance: null });

    useEffect(() => {
        if (!wallet || typeof wallet.on !== 'function' || typeof wallet.off !== 'function') {
            return;
        }

        const flushBalanceEvent = () => {
            const pending = balanceEventRef.current;
            pending.timer = null;
            const value = pending.value;
            pending.value = null;
            if (value) {
                markDiag(diag, 'wallet.events.balance.flush', {});
                setSatsBalanceResult(value);
            }
        };

        const flushIncomingEvent = () => {
            const pending = incomingEventRef.current;
            pending.timer = null;
            const balance = pending.balance;
            pending.balance = null;
            if (balance != null) {
                setBalance(balance);
            }
            markDiag(diag, 'wallet.events.incoming.flush', { hasBalance: balance != null });
            void updateWalletData({ transfers: true, balance: false, reason: 'incoming' });
        };

        const handleTokenBalanceUpdate = (event) => {
            if (event?.tokenBalances instanceof Map) {
                setTokenBalances(new Map(event.tokenBalances));
            }
        };

        const handleBalanceUpdate = (nextSatsBalance) => {
            if (!nextSatsBalance || typeof nextSatsBalance !== 'object') {
                return;
            }
            const pending = balanceEventRef.current;
            pending.value = nextSatsBalance;
            if (!pending.timer) {
                pending.timer = setTimeout(flushBalanceEvent, BALANCE_EVENT_COALESCE_MS);
            }
        };

        const handleIncomingBalance = (updatedBalance) => {
            if (updatedBalance != null) {
                incomingEventRef.current.balance = updatedBalance;
            }
            if (!incomingEventRef.current.timer) {
                incomingEventRef.current.timer = setTimeout(flushIncomingEvent, INCOMING_UPDATE_COALESCE_MS);
            }
        };

        const handleTransferClaimed = (transferId, updatedBalance) => {
            if (updatedBalance != null) {
                setBalance(updatedBalance);
            }
            markDiag(diag, 'wallet.events.transfer.claimed', { hasTransferId: !!transferId });
            void rememberTransfer?.(transferId);
        };

        const handleDepositConfirmed = (_id, updatedBalance) => {
            handleIncomingBalance(updatedBalance);
        };

        wallet.on(WALLET_EVENTS.balance, handleBalanceUpdate);
        wallet.on(WALLET_EVENTS.tokenBalance, handleTokenBalanceUpdate);
        wallet.on(WALLET_EVENTS.depositConfirmed, handleDepositConfirmed);
        wallet.on(WALLET_EVENTS.transferClaimed, handleTransferClaimed);

        return () => {
            wallet.off(WALLET_EVENTS.balance, handleBalanceUpdate);
            wallet.off(WALLET_EVENTS.tokenBalance, handleTokenBalanceUpdate);
            wallet.off(WALLET_EVENTS.depositConfirmed, handleDepositConfirmed);
            wallet.off(WALLET_EVENTS.transferClaimed, handleTransferClaimed);
            if (balanceEventRef.current.timer) {
                clearTimeout(balanceEventRef.current.timer);
                balanceEventRef.current.timer = null;
            }
            if (incomingEventRef.current.timer) {
                clearTimeout(incomingEventRef.current.timer);
                incomingEventRef.current.timer = null;
            }
        };
    }, [diag, wallet, updateWalletData, rememberTransfer, setBalance, setTokenBalances, setSatsBalanceResult]);
}

export function useWalletPolling({ wallet, appState, hasPendingTxs, updateWalletData, refreshWallet, refreshClaims }) {
    const pollIntervalRef = useRef(null);

    const isActive = useCallback(() => {
        return !appState?.currentState || appState.currentState === 'active';
    }, [appState]);

    const startPoll = useCallback(() => {
        if (pollIntervalRef.current || !wallet || !hasPendingTxs || !isActive()) {
            return;
        }

        pollIntervalRef.current = setInterval(() => {
            if (!isActive()) {
                return;
            }

            void updateWalletData({ transfers: true, balance: false, reason: 'poll' });
        }, POLL_TXS_RATE);
    }, [wallet, hasPendingTxs, isActive, updateWalletData]);

    const stopPoll = useCallback(() => {
        clearTimer(pollIntervalRef);
    }, []);

    useEffect(() => {
        if (!wallet) {
            stopPoll();
            return;
        }

        if (hasPendingTxs && isActive()) {
            startPoll();
            return;
        }

        stopPoll();
    }, [wallet, hasPendingTxs, isActive, startPoll, stopPoll]);

    useEffect(() => {
        if (!wallet || !appState?.addEventListener) {
            return;
        }

        const sub = appState.addEventListener('change', (nextState) => {
            if (nextState === 'active') {
                if (hasPendingTxs) {
                    startPoll();
                }
                void refreshWallet();
                return;
            }

            stopPoll();
        });

        return () => sub?.remove?.();
    }, [appState, hasPendingTxs, refreshWallet, startPoll, stopPoll, wallet]);

    useEffect(() => {
        if (!wallet) {
            return;
        }

        const intervalId = setInterval(() => {
            if (!isActive()) {
                return;
            }

            void refreshClaims();
        }, ACTIVE_CLAIM_RATE);

        return () => {
            clearInterval(intervalId);
        };
    }, [isActive, wallet, refreshClaims]);

    return stopPoll;
}

export function useWalletBoot({ wallet, getFundingAddress, getBalance, getRecentTxs, ensureTxCoverage, stopPoll, diag }) {
    useEffect(() => {
        if (!wallet) {
            return;
        }

        let cancelled = false;
        const boot = async () => {
            const startedAt = Date.now();
            markDiag(diag, 'wallet.provider.boot.start', {});
            void getFundingAddress().catch((error) => {
                console.debug?.('could not get funding address', error?.message ?? error);
            });
            const [, firstTxPage] = await Promise.all([getBalance(), getRecentTxs()]);
            markDone(diag, 'wallet.provider.boot', startedAt, {
                cancelled: !!cancelled,
                firstTxCount: firstTxPage?.transfers?.length || 0,
                firstTxHasMore: !!firstTxPage?.hasMore,
                cachedHistoryComplete: firstTxPage?.cachedHistoryComplete === true,
                reconcileCount: Array.isArray(firstTxPage?.reconcileIds) ? firstTxPage.reconcileIds.length : 0,
            });
            if (cancelled || !firstTxPage?.transfers?.length || !firstTxPage.hasMore) {
                return;
            }

            if (!cancelled) {
                void ensureTxCoverage(null, {
                    force: true,
                    publish: false,
                    stopAtIds: firstTxPage.cachedHistoryComplete === true ? firstTxPage.reconcileIds : null,
                    completeOnStop: firstTxPage.cachedHistoryComplete === true,
                    label: 'wallet.reconcileTxs',
                });
            }
        };

        void boot();

        return () => {
            cancelled = true;
            markDiag(diag, 'wallet.provider.boot.stop', {});
            stopPoll();
        };
    }, [diag, wallet, ensureTxCoverage, getBalance, getFundingAddress, getRecentTxs, stopPoll]);
}

export function useWalletReadyDiag({ wallet, balance, balanceReady, txReady, transferCount, diag }) {
    const lastReadyKeyRef = useRef('');

    useEffect(() => {
        const key = `${!!wallet}:${balanceReady}:${txReady}:${balance != null}:${transferCount}`;
        if (lastReadyKeyRef.current === key) {
            return;
        }
        lastReadyKeyRef.current = key;
        markDiag(diag, 'wallet.provider.state', {
            hasWallet: !!wallet,
            balanceReady,
            txReady,
            hasBalance: balance != null,
            transferCount,
            loaded: !!wallet && balanceReady && txReady,
        });
    }, [balance, balanceReady, diag, transferCount, txReady, wallet]);
}
