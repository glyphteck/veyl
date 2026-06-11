'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Loading from '@/components/loading';
import Navbar from '@/components/navbar';
import { useChat, useChatInput } from '@/components/providers/chatprovider';
import { AppDialogHost, useDialog, useDialogState } from '@/components/providers/dialogprovider';
import { PeerProvider, usePeer } from '@/components/providers/peerprovider';
import { ShortcutProvider } from '@/components/providers/shortcutprovider';
import { TxDataProvider } from '@/components/providers/txdataprovider';
import { useUser } from '@/components/providers/userprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { dropPendingInvite, readPendingInvite } from '@/lib/invite';
import { invite } from '@veyl/shared/invite';
import { WalletProvider } from '@/components/providers/walletprovider';
import { writeResumeTarget } from '@veyl/shared/cache/localdata';
import { resumeTargetFromPath } from '@veyl/shared/navigation/resume';

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

function PendingInviteHandler() {
    const router = useRouter();
    const user = useUser();
    const { openDialog } = useDialog();
    const { selectPeerChat } = useChat();
    const { addPeer } = usePeer();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        const pending = readPendingInvite();
        if (!pending) return;

        async function run() {
            if (pending.kind === invite.chat && pending.from && pending.from !== user.username) {
                const peer = await addPeer({ username: pending.from });
                if (peer?.chatPK) {
                    await selectPeerChat(peer.chatPK);
                    router.replace('/chat');
                }
            }
            if (pending.kind === invite.request && pending.walletPK) {
                const peer = await addPeer({ walletPK: pending.walletPK }).catch(() => null);
                if (peer) {
                    openDialog('payments', { peer, tab: 'send', amount: pending.amount ?? null });
                }
                router.replace('/wallet');
            }
        }

        run()
            .catch((error) => console.warn('pending invite failed', error))
            .finally(() => dropPendingInvite());
    }, [addPeer, openDialog, router, selectPeerChat, user.username]);

    return null;
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
        function saveCurrentRoute() {
            if (!unlockedRef.current) return;
            const target = resumeTargetFromPath(pathnameRef.current);
            if (!target) return;
            writeResumeTarget(cacheRef.current, target);
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
            const target = resumeTargetFromPath(pathnameRef.current);
            if (target) {
                writeResumeTarget(cacheRef.current, target);
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
                        <ShortcutProvider>
                            <PendingInviteHandler />
                            <AppShell>{children}</AppShell>
                        </ShortcutProvider>
                    </AppDialogHost>
                </PeerProvider>
            </TxDataProvider>
        </WalletProvider>
    );
}
