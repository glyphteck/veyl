'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Loading from '@/components/loading';
import { UserProvider } from '@/components/providers/userprovider';
import { VaultProvider, useVault } from '@/components/providers/vaultprovider';
import { ChatProvider } from '@/components/providers/chatprovider';
import { CloakProvider } from '@veyl/shared/providers/cloakprovider';
import { readResumeTarget } from '@veyl/shared/cache/localdata';
import { hrefForResumeTarget } from '@veyl/shared/navigation/resume';

function VaultRouteGate({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const { localCache, lockState } = useVault();
    const unlockRoute = pathname === '/unlock' || pathname?.startsWith('/unlock/');
    const unlocked = lockState === 'unlocked';
    const leaveUnlock = unlocked && unlockRoute;
    const goUnlock = !unlocked && !unlockRoute;
    const appTarget = leaveUnlock ? readResumeTarget(localCache) : null;
    const appRoute = leaveUnlock ? hrefForResumeTarget(appTarget) : '/chat';

    useEffect(() => {
        if (leaveUnlock) {
            router.replace(appRoute);
            return;
        }
        if (goUnlock) {
            router.replace('/unlock');
        }
    }, [appRoute, goUnlock, leaveUnlock, router]);

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
