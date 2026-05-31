import { useCallback, useRef, useState } from 'react';

import { markDiag, markDone, markError } from '../utils/diagnostics.js';

export function useFundingAddress({ wallet, diag }) {
    const [fundingAddress, setFundingAddress] = useState(null);
    const fundingAddressPromiseRef = useRef(null);
    const fundingAddressRef = useRef(null);

    const setNextFundingAddress = useCallback((address) => {
        const nextAddress = typeof address === 'string' && address.trim() ? address.trim() : null;
        if (!nextAddress) {
            return null;
        }

        fundingAddressRef.current = nextAddress;
        setFundingAddress((currentAddress) => (currentAddress === nextAddress ? currentAddress : nextAddress));
        return nextAddress;
    }, []);

    const getFundingAddress = useCallback(async () => {
        if (!wallet) {
            return null;
        }
        if (fundingAddressRef.current) {
            markDiag(diag, 'wallet.fundingAddress.cache.hit', {});
            return fundingAddressRef.current;
        }

        if (fundingAddressPromiseRef.current) {
            markDiag(diag, 'wallet.fundingAddress.reuse', {});
            return fundingAddressPromiseRef.current;
        }

        const startedAt = Date.now();
        markDiag(diag, 'wallet.fundingAddress.start', {});
        fundingAddressPromiseRef.current = wallet
            .getStaticDepositAddress()
            .then((address) => {
                const nextAddress = setNextFundingAddress(address);
                markDone(diag, 'wallet.fundingAddress', startedAt, { found: !!nextAddress });
                return nextAddress;
            })
            .catch((error) => {
                markError(diag, 'wallet.fundingAddress', startedAt, error);
                throw error;
            })
            .finally(() => {
                fundingAddressPromiseRef.current = null;
            });

        return fundingAddressPromiseRef.current;
    }, [diag, wallet, setNextFundingAddress]);

    const resetFundingAddress = useCallback(() => {
        setFundingAddress(null);
        fundingAddressRef.current = null;
        fundingAddressPromiseRef.current = null;
    }, []);

    return {
        fundingAddress,
        getFundingAddress,
        resetFundingAddress,
    };
}
