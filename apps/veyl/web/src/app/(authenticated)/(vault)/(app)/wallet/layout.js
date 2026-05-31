'use client';

import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { renderMoney } from '@veyl/shared/money';
import { useEffect } from 'react';

export default function WalletTitleLayout({ children }) {
    const bitcoin = useBitcoin();
    const { balance } = useWallet();
    const { settings } = useUser();
    const { cloaked } = useCloak();
    const moneyFormat = settings.moneyFormat;

    useEffect(() => {
        if (cloaked) {
            document.title = 'wallet';
        } else if (balance !== null && balance !== undefined && balance > 0) {
            const formattedBalance = renderMoney(balance, moneyFormat, bitcoin.price);
            document.title = formattedBalance;
        } else {
            document.title = 'wallet';
        }
    }, [balance, moneyFormat, bitcoin.price, cloaked]);

    return children;
}
