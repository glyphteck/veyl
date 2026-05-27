'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Loading from '@/components/loading';
import Navbar from '@/components/navbar';
import { useChatInput } from '@/components/providers/chatprovider';
import { AppDialogHost, useDialogState } from '@/components/providers/dialogprovider';
import { PeerProvider } from '@/components/providers/peerprovider';
import { TxDataProvider } from '@/components/providers/txdataprovider';
import { useUser } from '@/components/providers/userprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { WalletProvider } from '@/components/providers/walletprovider';
import { logout } from '@/lib/useractions';
import { writeLastAppTarget } from '@glyphteck/shared/localdatacache';
import { lastAppTargetForPathname } from '@/lib/approute';

function ChatDialogFocusRestore() {
    const pathname = usePathname();
    const dialog = useDialogState();
    const { focusChatInput } = useChatInput();
    const hadDialogRef = useRef(false);

    useEffect(() => {
        const hasDialog = !!dialog?.type;
        if (hadDialogRef.current && !hasDialog && pathname === '/chat') {
            const frame = window.requestAnimationFrame(() => {
                focusChatInput();
            });
            hadDialogRef.current = hasDialog;
            return () => window.cancelAnimationFrame(frame);
        }
        hadDialogRef.current = hasDialog;
        return undefined;
    }, [dialog?.type, focusChatInput, pathname]);

    return null;
}

function AppShell({ children }) {
    useEffect(() => {
        const previousHtmlOverflow = document.documentElement.style.overflow;
        const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
        const previousBodyOverflow = document.body.style.overflow;
        const previousBodyOverscroll = document.body.style.overscrollBehavior;

        document.documentElement.style.overflow = 'hidden';
        document.documentElement.style.overscrollBehavior = 'none';
        document.body.style.overflow = 'hidden';
        document.body.style.overscrollBehavior = 'none';

        return () => {
            document.documentElement.style.overflow = previousHtmlOverflow;
            document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
            document.body.style.overflow = previousBodyOverflow;
            document.body.style.overscrollBehavior = previousBodyOverscroll;
        };
    }, []);

    return (
        <div className="relative flex h-screen flex-col overscroll-none px-2 pb-2">
            <ChatDialogFocusRestore />
            <Navbar />
            <main className="min-h-0 flex-1">{children}</main>
        </div>
    );
}

export default function AppLayout({ children }) {
    const user = useUser();
    const pathname = usePathname();
    const { localCache, lockState } = useVault();
    const pathnameRef = useRef(pathname);
    const cacheRef = useRef(localCache);
    const unlockedRef = useRef(lockState === 'unlocked');
    const wasUnlockedRef = useRef(lockState === 'unlocked');

    pathnameRef.current = pathname;
    cacheRef.current = localCache;
    unlockedRef.current = lockState === 'unlocked';

    useEffect(() => {
        if (user.authReady && !user.uid) {
            logout();
        }
    }, [user.authReady, user.uid]);

    useEffect(() => {
        function saveCurrentRoute() {
            if (!unlockedRef.current) return;
            const target = lastAppTargetForPathname(pathnameRef.current);
            if (!target) return;
            writeLastAppTarget(cacheRef.current, target);
            void cacheRef.current?.flush?.();
        }

        function handleVisibilityChange() {
            if (document.visibilityState === 'hidden') {
                saveCurrentRoute();
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pagehide', saveCurrentRoute);
        return () => {
            saveCurrentRoute();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pagehide', saveCurrentRoute);
        };
    }, []);

    useEffect(() => {
        if (wasUnlockedRef.current && lockState !== 'unlocked') {
            const target = lastAppTargetForPathname(pathnameRef.current);
            if (target) {
                writeLastAppTarget(cacheRef.current, target);
                void cacheRef.current?.flush?.();
            }
        }
        wasUnlockedRef.current = lockState === 'unlocked';
    }, [lockState]);

    if (!user.uid) return <Loading />;
    if (lockState !== 'unlocked') return <Loading />;

    return (
        <WalletProvider>
            <TxDataProvider>
                <PeerProvider>
                    <AppDialogHost>
                        <AppShell>{children}</AppShell>
                    </AppDialogHost>
                </PeerProvider>
            </TxDataProvider>
        </WalletProvider>
    );
}
