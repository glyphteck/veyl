'use client';

import { WalletDashboard } from '@/components/wallet/walletdashboard';
import { RecentTxList } from '@/components/wallet/recenttxlist';
import Loading from '@/components/loading';
import { useTxData } from '@/components/providers/txdataprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { Button } from '@/components/button';
import { BanknoteArrowDown } from 'lucide-react';
import { qr } from '@veyl/shared/qr';

export default function WalletPage() {
    const txData = useTxData();
    const { copyFundingAddress, fundingAddress, getFundingAddress, isWalletDataLoaded, txReady } = useWallet();
    const { openDialog } = useDialog();
    const hasTransactions = txData?.hasTx || false;

    const openFundingQr = async () => {
        const address = fundingAddress || (await getFundingAddress());
        if (!address) return;
        openDialog('qrcode', { type: qr.bitcoin, value: address });
        void copyFundingAddress(address).catch(() => {});
    };

    if (!isWalletDataLoaded) {
        return (
            <div className="relative h-full">
                <Loading overlay />
            </div>
        );
    }

    if (txReady && !hasTransactions) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <p className="text-lg text-muted">Start by funding your wallet, or ask a friend to send you some sats.</p>
                    <Button
                        onClick={openFundingQr}
                        className="button-fill shrinker text-lg w-3xs mt-4"
                    >
                        <BanknoteArrowDown />
                        fund wallet
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex gap-2">
            <div className="min-w-[19rem] flex-1 block sm:block md:hidden lg:block">
                <RecentTxList />
            </div>
            <div className="flex-4 hidden md:block">
                <WalletDashboard />
            </div>
        </div>
    );
}
