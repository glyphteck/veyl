import { useCallback, useRef, useState } from 'react';

import { markDiag, markDone, markError } from '../utils/diagnostics.js';

export function availableBalanceSats(balance, fallback = 0n) {
    if (balance == null) {
        return fallback;
    }
    const value = Number(balance);
    if (!Number.isFinite(value) || value < 0) {
        return 0n;
    }
    return BigInt(Math.floor(value));
}

export function hasAvailableBalance(balance) {
    return Number(balance ?? 0) > 0;
}

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

function samePlainObject(a, b) {
    if (a === b) {
        return true;
    }
    if (!a || !b) {
        return false;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }

    return aKeys.every((key) => Object.is(a[key], b[key]));
}

function sameTokenBalances(a, b) {
    if (a === b) {
        return true;
    }
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) {
        return false;
    }

    for (const [key, value] of a.entries()) {
        if (!Object.is(value, b.get(key))) {
            return false;
        }
    }
    return true;
}

export function useWalletBalance({ wallet, diag }) {
    const [balance, setBalance] = useState(null);
    const [satsBalance, setSatsBalance] = useState(null);
    const [tokenBalances, setTokenBalances] = useState(() => new Map());
    const [balanceReady, setBalanceReady] = useState(false);
    const [isBalanceLoading, setIsBalanceLoading] = useState(false);
    const balanceRef = useRef(null);
    const satsBalanceRef = useRef(null);
    const tokenBalancesRef = useRef(new Map());
    const balanceReadyRef = useRef(false);

    const setBalanceValue = useCallback((nextBalance) => {
        const value = typeof nextBalance === 'function' ? nextBalance(balanceRef.current) : nextBalance;
        if (Object.is(balanceRef.current, value)) {
            return;
        }
        balanceRef.current = value;
        setBalance(value);
    }, []);

    const setSatsBalanceValue = useCallback((nextSatsBalance) => {
        const value = typeof nextSatsBalance === 'function' ? nextSatsBalance(satsBalanceRef.current) : nextSatsBalance;
        if (samePlainObject(satsBalanceRef.current, value)) {
            return;
        }
        satsBalanceRef.current = value;
        setSatsBalance(value);
    }, []);

    const setTokenBalancesValue = useCallback((nextTokenBalances) => {
        const source = nextTokenBalances instanceof Map ? nextTokenBalances : new Map();
        if (sameTokenBalances(tokenBalancesRef.current, source)) {
            return;
        }
        const value = new Map(source);
        tokenBalancesRef.current = value;
        setTokenBalances(value);
    }, []);

    const setBalanceReadyValue = useCallback((nextReady) => {
        const value = nextReady === true;
        if (balanceReadyRef.current === value) {
            return;
        }
        balanceReadyRef.current = value;
        setBalanceReady(value);
    }, []);

    const setBalanceResult = useCallback((result) => {
        const nextBalance = getBalanceValue(result);
        if (nextBalance != null) {
            setBalanceValue(nextBalance);
        }

        const nextSatsBalance = getSatsBalance(result);
        if (nextSatsBalance) {
            setSatsBalanceValue(nextSatsBalance);
        }

        const nextTokenBalances = getTokenBalances(result);
        if (nextTokenBalances) {
            setTokenBalancesValue(nextTokenBalances);
        }
    }, [setBalanceValue, setSatsBalanceValue, setTokenBalancesValue]);

    const setSatsBalanceResult = useCallback((nextSatsBalance) => {
        if (!nextSatsBalance || typeof nextSatsBalance !== 'object') {
            return;
        }

        setSatsBalanceValue(nextSatsBalance);
        if (nextSatsBalance.available != null) {
            setBalanceValue(nextSatsBalance.available);
        }
    }, [setBalanceValue, setSatsBalanceValue]);

    const getBalance = useCallback(async () => {
        if (!wallet) {
            return;
        }

        const startedAt = Date.now();
        const showLoading = !balanceReadyRef.current;
        markDiag(diag, 'wallet.balance.start', {});
        if (showLoading) {
            setIsBalanceLoading(true);
        }
        try {
            const result = await wallet.getBalance();
            setBalanceResult(result);
            markDone(diag, 'wallet.balance', startedAt, { hasBalance: getBalanceValue(result) != null, hasSatsBalance: !!getSatsBalance(result), hasTokenBalances: !!getTokenBalances(result) });
        } catch (error) {
            markError(diag, 'wallet.balance', startedAt, error);
            console.debug?.('could not get balance', error?.message ?? error);
        } finally {
            setBalanceReadyValue(true);
            if (showLoading) {
                setIsBalanceLoading(false);
            }
        }
    }, [diag, wallet, setBalanceReadyValue, setBalanceResult]);

    const resetBalance = useCallback(() => {
        balanceRef.current = null;
        satsBalanceRef.current = null;
        tokenBalancesRef.current = new Map();
        balanceReadyRef.current = false;
        setBalance(null);
        setSatsBalance(null);
        setTokenBalances(tokenBalancesRef.current);
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
        setBalance: setBalanceValue,
        setTokenBalances: setTokenBalancesValue,
        setSatsBalanceResult,
    };
}
