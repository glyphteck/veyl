'use client';

import { useCallback, useMemo } from 'react';
import { createWalletProvider } from '@veyl/shared/wallet';
import { resolveNetwork } from '@veyl/shared/network';
import { useVault } from '@/components/providers/vaultprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { useUser } from '@/components/providers/userprovider';
import { toast } from '@/components/notifications';
import { Copy } from 'lucide-react';
import { mark } from '@/lib/diagnostics';

function useWalletExtras({ fundingAddress, getFundingAddress }) {
    const { cloaked } = useCloak();

    const copyFundingAddress = useCallback(async (addressInput = null) => {
        try {
            const readyAddress = typeof addressInput === 'string' && addressInput.trim() ? addressInput.trim() : null;
            const address = readyAddress || fundingAddress || (await getFundingAddress());
            if (!address) return;

            await navigator.clipboard.writeText(address);
            toast('funding address copied to clipboard', {
                ...(cloaked ? {} : { description: address, descriptionMode: 'middle' }),
                icon: <Copy />,
            });

            return address;
        } catch (error) {
            toast.error('Failed to get funding address');
            throw error;
        }
    }, [cloaked, fundingAddress, getFundingAddress]);

    return useMemo(
        () => ({
            copyFundingAddress,
        }),
        [copyFundingAddress]
    );
}

function useWalletSettings() {
    const { settings } = useUser();
    return settings;
}

function useWalletIdentity() {
    const { walletPK } = useUser();
    return useMemo(() => ({ walletPK }), [walletPK]);
}

const { WalletProvider, useWallet } = createWalletProvider({
    useVault,
    network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
    useWalletExtras,
    useWalletSettings,
    useWalletIdentity,
    diag: mark,
});

export { WalletProvider, useWallet };
