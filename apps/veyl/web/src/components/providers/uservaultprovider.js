'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { UserProvider } from '@/components/providers/userprovider';
import { VaultProvider, useVault } from '@/components/providers/vaultprovider';
import { ChatProvider, useChat } from '@/components/providers/chatprovider';
import { CloakProvider } from '@glyphteck/shared/providers/cloakprovider';

function VaultRouteGate({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const { lockState } = useVault();
    const { isChatDataReady } = useChat();
    const unlockRoute = pathname === '/unlock' || pathname?.startsWith('/unlock/');
    const unlocked = lockState === 'unlocked';
    const leaveUnlock = unlocked && unlockRoute && isChatDataReady;

    useEffect(() => {
        if (leaveUnlock) {
            router.replace('/chat');
            return;
        }
        if (!unlocked && !unlockRoute) {
            router.replace('/unlock');
        }
    }, [leaveUnlock, router, unlockRoute, unlocked]);

    if (leaveUnlock || (!unlocked && !unlockRoute)) {
        return null;
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
