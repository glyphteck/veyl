'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Loading from '@/components/loading';
import Navbar from '@/components/navbar';
import { DialogProvider } from '@/components/providers/dialogprovider';
import { useChat } from '@/components/providers/chatprovider';
import { PeerProvider, usePeer } from '@/components/providers/peerprovider';
import { TxDataProvider } from '@/components/providers/txdataprovider';
import { useUser } from '@/components/providers/userprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { WalletProvider } from '@/components/providers/walletprovider';
import { logout } from '@/lib/useractions';

function AppShell({ children }) {
    const { isChatDataReady } = useChat();
    const { isPeerDataReady } = usePeer();
    const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);
    const isDataReady = isChatDataReady && isPeerDataReady;

    useEffect(() => {
        if (isDataReady && !hasInitiallyLoaded) setHasInitiallyLoaded(true);
    }, [isDataReady, hasInitiallyLoaded]);

    return !hasInitiallyLoaded ? (
        <Loading />
    ) : (
        <DialogProvider>
            <div className="relative flex h-screen flex-col px-2 pb-2">
                <Navbar />
                <main className="min-h-0 flex-1">{children}</main>
            </div>
        </DialogProvider>
    );
}

export default function AppLayout({ children }) {
    const user = useUser();
    const { lockState } = useVault();
    const router = useRouter();

    useEffect(() => {
        if (lockState !== 'unlocked') router.replace('/unlock');
    }, [lockState, router]);

    useEffect(() => {
        if (user.authReady && !user.uid) {
            logout();
        }
    }, [user.authReady, user.uid]);

    if (!user.uid || !user.settingsReady) return <Loading />;
    if (lockState !== 'unlocked') return null;

    return (
        <WalletProvider>
            <TxDataProvider>
                <PeerProvider>
                    <AppShell>{children}</AppShell>
                </PeerProvider>
            </TxDataProvider>
        </WalletProvider>
    );
}
