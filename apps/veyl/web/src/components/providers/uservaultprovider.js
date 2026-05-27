'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getChatId } from '@glyphteck/shared/crypto/chat';
import Loading from '@/components/loading';
import { UserProvider, useUser } from '@/components/providers/userprovider';
import { VaultProvider, useVault } from '@/components/providers/vaultprovider';
import { ChatProvider, useChat } from '@/components/providers/chatprovider';
import { CloakProvider } from '@glyphteck/shared/providers/cloakprovider';
import { readLastAppTarget } from '@glyphteck/shared/localdatacache';
import { hrefForLastAppTarget } from '@/lib/approute';

function cleanChatPK(value) {
    const chatPK = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[0-9a-f]{64}$/.test(chatPK) ? chatPK : null;
}

function VaultRouteGate({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const { chatPK } = useUser();
    const { localCache, lockState } = useVault();
    const { selectedChatId, selectChat } = useChat();
    const unlockRoute = pathname === '/unlock' || pathname?.startsWith('/unlock/');
    const unlocked = lockState === 'unlocked';
    const leaveUnlock = unlocked && unlockRoute;
    const goUnlock = !unlocked && !unlockRoute;
    const appTarget = leaveUnlock ? readLastAppTarget(localCache) : null;
    const appRoute = leaveUnlock ? hrefForLastAppTarget(appTarget) : '/chat';
    const ownChatPK = cleanChatPK(chatPK);
    const targetChatPeer = appTarget?.route === '/chat' ? cleanChatPK(appTarget.chatPeer) : null;
    const targetChatId = useMemo(() => (ownChatPK && targetChatPeer ? getChatId(ownChatPK, targetChatPeer) : null), [ownChatPK, targetChatPeer]);

    useEffect(() => {
        if (leaveUnlock) {
            if (targetChatId && selectedChatId !== targetChatId) {
                selectChat(targetChatId);
            }
            router.replace(appRoute);
            return;
        }
        if (goUnlock) {
            router.replace('/unlock');
        }
    }, [appRoute, goUnlock, leaveUnlock, router, selectChat, selectedChatId, targetChatId]);

    if (goUnlock) {
        return <Loading />;
    }

    return children;
}

export function UserVaultProvider({ children }) {
    return (
        <UserProvider>
            <VaultProvider>
                <ChatProvider>
                    <CloakProvider>
                        <VaultRouteGate>{children}</VaultRouteGate>
                    </CloakProvider>
                </ChatProvider>
            </VaultProvider>
        </UserProvider>
    );
}
