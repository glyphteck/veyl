import { useCallback, useEffect, useRef } from 'react';

import {
    WALLET_ACTIVE_CLAIM_POLL_MS,
    WALLET_MIN_BOOT_TX_COVERAGE_MS,
    WALLET_TRANSFER_POLL_MS,
    WALLET_UPDATE_RATE_LIMIT_MS,
} from '../config.js';
import { markDiag, markDone } from '../utils/diagnostics.js';

const RATE_LIMIT = WALLET_UPDATE_RATE_LIMIT_MS;
const POLL_TXS_RATE = WALLET_TRANSFER_POLL_MS;
const ACTIVE_CLAIM_RATE = WALLET_ACTIVE_CLAIM_POLL_MS;
const MIN_BOOT_TX_COVERAGE_MS = WALLET_MIN_BOOT_TX_COVERAGE_MS;
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

export function useWalletData({ wallet, getBalance, getRecentTxs, diag }) {
    const lastFetchTime = useRef(0);
    const updatePromiseRef = useRef(null);
    const queuedForceRef = useRef(false);

    return useCallback(
        async (force = false) => {
            if (!wallet) {
                return;
            }

            if (updatePromiseRef.current) {
                if (force) {
                    queuedForceRef.current = true;
                }
                markDiag(diag, 'wallet.update.join', { force: !!force, queuedForce: queuedForceRef.current });
                return updatePromiseRef.current;
            }

            const run = async () => {
                let currentForce = !!force;

                while (true) {
                    const now = Date.now();
                    if (!currentForce && now - lastFetchTime.current < RATE_LIMIT) {
                        markDiag(diag, 'wallet.update.skip', { force: currentForce, ageMs: now - lastFetchTime.current });
                        return;
                    }

                    const startedAt = Date.now();
                    markDiag(diag, 'wallet.update.start', { force: currentForce });
                    lastFetchTime.current = now;
                    await Promise.all([getBalance(), getRecentTxs()]);
                    markDone(diag, 'wallet.update', startedAt, { force: currentForce });

                    if (!queuedForceRef.current) {
                        return;
                    }

                    queuedForceRef.current = false;
                    currentForce = true;
                    markDiag(diag, 'wallet.update.drain', { force: currentForce });
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

export function useWalletEvents({ wallet, updateWalletData, setBalance, setTokenBalances, setSatsBalanceResult }) {
    useEffect(() => {
        if (!wallet || typeof wallet.on !== 'function' || typeof wallet.off !== 'function') {
            return;
        }

        const handleTokenBalanceUpdate = (event) => {
            if (event?.tokenBalances instanceof Map) {
                setTokenBalances(new Map(event.tokenBalances));
            }
        };

        const handleBalanceUpdate = (nextSatsBalance) => {
            setSatsBalanceResult(nextSatsBalance);
        };

        const handleIncomingFunds = async (_id, updatedBalance) => {
            if (updatedBalance != null) {
                setBalance(updatedBalance);
            }
            await updateWalletData(true);
        };

        wallet.on(WALLET_EVENTS.balance, handleBalanceUpdate);
        wallet.on(WALLET_EVENTS.tokenBalance, handleTokenBalanceUpdate);
        wallet.on(WALLET_EVENTS.depositConfirmed, handleIncomingFunds);
        wallet.on(WALLET_EVENTS.transferClaimed, handleIncomingFunds);

        return () => {
            wallet.off(WALLET_EVENTS.balance, handleBalanceUpdate);
            wallet.off(WALLET_EVENTS.tokenBalance, handleTokenBalanceUpdate);
            wallet.off(WALLET_EVENTS.depositConfirmed, handleIncomingFunds);
            wallet.off(WALLET_EVENTS.transferClaimed, handleIncomingFunds);
        };
    }, [wallet, updateWalletData, setBalance, setTokenBalances, setSatsBalanceResult]);
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

            void updateWalletData();
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
            });
            if (cancelled || !firstTxPage?.transfers?.length || !firstTxPage.hasMore) {
                return;
            }

            if (!cancelled) {
                void ensureTxCoverage(Date.now() - MIN_BOOT_TX_COVERAGE_MS);
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
