import { useCallback, useState } from 'react';

import { markDiag, markDone, markError } from './diag.js';

function getBalanceValue(result) {
    return result?.satsBalance?.available ?? result?.balance ?? null;
}

function getTokenBalances(result) {
    return result?.tokenBalances instanceof Map ? result.tokenBalances : null;
}

function getSatsBalance(result) {
    const satsBalance = result?.satsBalance;
    if (!satsBalance || typeof satsBalance !== 'object') {
        return null;
    }
    return satsBalance;
}

export function useWalletBalance({ wallet, diag }) {
    const [balance, setBalance] = useState(null);
    const [satsBalance, setSatsBalance] = useState(null);
    const [tokenBalances, setTokenBalances] = useState(() => new Map());
    const [balanceReady, setBalanceReady] = useState(false);
    const [isBalanceLoading, setIsBalanceLoading] = useState(false);

    const setBalanceResult = useCallback((result) => {
        const nextBalance = getBalanceValue(result);
        if (nextBalance != null) {
            setBalance(nextBalance);
        }

        const nextSatsBalance = getSatsBalance(result);
        if (nextSatsBalance) {
            setSatsBalance(nextSatsBalance);
        }

        const nextTokenBalances = getTokenBalances(result);
        if (nextTokenBalances) {
            setTokenBalances(new Map(nextTokenBalances));
        }
    }, []);

    const setSatsBalanceResult = useCallback((nextSatsBalance) => {
        if (!nextSatsBalance || typeof nextSatsBalance !== 'object') {
            return;
        }

        setSatsBalance(nextSatsBalance);
        if (nextSatsBalance.available != null) {
            setBalance(nextSatsBalance.available);
        }
    }, []);

    const getBalance = useCallback(async () => {
        if (!wallet) {
            return;
        }

        const startedAt = Date.now();
        markDiag(diag, 'wallet.balance.start', {});
        setIsBalanceLoading(true);
        try {
            const result = await wallet.getBalance();
            setBalanceResult(result);
            markDone(diag, 'wallet.balance', startedAt, { hasBalance: getBalanceValue(result) != null, hasSatsBalance: !!getSatsBalance(result), hasTokenBalances: !!getTokenBalances(result) });
        } catch (error) {
            markError(diag, 'wallet.balance', startedAt, error);
            console.debug?.('could not get balance', error?.message ?? error);
        } finally {
            setBalanceReady(true);
            setIsBalanceLoading(false);
        }
    }, [diag, wallet, setBalanceResult]);

    const resetBalance = useCallback(() => {
        setBalance(null);
        setSatsBalance(null);
        setTokenBalances(new Map());
        setBalanceReady(false);
        setIsBalanceLoading(false);
    }, []);

    return {
        balance,
        satsBalance,
        tokenBalances,
        balanceReady,
        isBalanceLoading,
        getBalance,
        resetBalance,
        setBalance,
        setTokenBalances,
        setSatsBalanceResult,
    };
}
