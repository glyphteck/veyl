'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { normalizeOnchainFeeEstimate } from '../wallet/fees.js';

const DEFAULT_BITCOIN = Object.freeze({
    price: null,
    block: null,
    fees: null,
    updatedAt: null,
    ready: false,
    error: null,
});

function normalizeBitcoinData(data, current = DEFAULT_BITCOIN) {
    if (!data) {
        return current;
    }

    return {
        price: data.price ?? current?.price ?? null,
        block: data.block ?? current?.block ?? null,
        fees: data.fees ?? current?.fees ?? null,
        updatedAt: data.updatedAt ?? current?.updatedAt ?? null,
        ready: true,
        error: null,
    };
}

export function createBitcoinProvider({ cloud }) {
    if (!cloud) {
        throw new Error('createBitcoinProvider requires cloud');
    }

    const BitcoinContext = createContext(null);

    function BitcoinProvider({ children }) {
        const [bitcoin, setBitcoin] = useState(DEFAULT_BITCOIN);

        useEffect(() => {
            return cloud.bitcoin.watch(
                (data) => {
                    setBitcoin((current) => normalizeBitcoinData(data, current));
                },
                (error) => {
                    console.debug?.('Failed to watch Bitcoin data', error?.message ?? error);
                    setBitcoin((current) => ({
                        ...current,
                        ready: false,
                        error,
                    }));
                }
            );
        }, [cloud]);

        const estimateTransactionFees = useCallback(
            ({ feeRate, speed = 'medium', vbytes, weightUnits, baseSats = 0 } = {}) => {
                const onchainEstimate = normalizeOnchainFeeEstimate({
                    bitcoin,
                    feeRate,
                    speed,
                    vbytes,
                    weightUnits,
                    baseSats,
                });
                if (!onchainEstimate) {
                    return { success: false, error: new Error('bitcoin fee estimate unavailable') };
                }

                return {
                    success: true,
                    fees: {
                        onchain: onchainEstimate,
                    },
                    onchainEstimate,
                };
            },
            [bitcoin]
        );

        const value = useMemo(
            () => ({
                ...bitcoin,
                estimateTransactionFees,
            }),
            [bitcoin, estimateTransactionFees]
        );

        return <BitcoinContext value={value}>{children}</BitcoinContext>;
    }

    function useBitcoin() {
        const context = useContext(BitcoinContext);
        if (!context) {
            throw new Error('useBitcoin must be used within a BitcoinProvider');
        }
        return context;
    }

    return { BitcoinProvider, useBitcoin, BitcoinContext };
}
