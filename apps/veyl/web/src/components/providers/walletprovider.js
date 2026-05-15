'use client';

import { useCallback, useMemo } from 'react';
import { createWalletProvider } from '@glyphteck/shared/wallet';
import { resolveNetwork } from '@glyphteck/shared/network';
import { db } from '@/lib/firebase/firebaseclient';
import { useVault } from '@/components/providers/vaultprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';

function useWalletExtras({ getFundingAddress }) {
    const { cloaked } = useCloak();

    const copyFundingAddress = useCallback(async () => {
        try {
            const address = await getFundingAddress();
            if (!address) return;

            await navigator.clipboard.writeText(address);
            toast('funding address copied to clipboard', {
                ...(cloaked ? {} : { description: address }),
                icon: <Copy />,
            });

            return address;
        } catch (error) {
            toast.error('Failed to get funding address');
            throw error;
        }
    }, [cloaked, getFundingAddress]);

    return useMemo(
        () => ({
            copyFundingAddress,
        }),
        [copyFundingAddress]
    );
}

const { WalletProvider, useWallet } = createWalletProvider({
    useVault,
    db,
    network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
    useWalletExtras,
});

export { WalletProvider, useWallet };
