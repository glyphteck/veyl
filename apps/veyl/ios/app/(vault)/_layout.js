import { useEffect, useRef } from 'react';
import { Stack, useNavigationContainerRef, useRouter } from 'expo-router';
import { readLastAppTarget } from '@glyphteck/shared/localdatacache';
import { hrefForLastAppTarget, lastAppTargetForNavigationState, routeNameForNavigationState } from '@/lib/approute';

import { WalletProvider } from '@/providers/walletprovider';
import { TxDataProvider } from '@/providers/txdataprovider';
import { ChatProvider } from '@/providers/chatprovider';
import { PeerProvider } from '@/providers/peerprovider';
import { PushProvider } from '@/providers/pushprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { mark } from '@/lib/diagnostics';

function VaultContent() {
    const { theme } = useTheme();
    const router = useRouter();
    const navigationRef = useNavigationContainerRef();
    const { lockState, faceIdFailed, localCache } = useVault();
    const user = useUser();
    const previousLockStateRef = useRef(lockState);

    const faceIDConfigured = user.settingsReady && typeof user.settings?.faceID === 'boolean';
    const faceIDEnabled = faceIDConfigured && user.settings.faceID === true;
    const isUnlocked = lockState === 'unlocked';
    const shouldShowFaceIdSetup = isUnlocked && !faceIDConfigured;
    const shouldShowApp = isUnlocked && faceIDConfigured;
    const shouldShowFaceIdUnlock = !isUnlocked && !shouldShowFaceIdSetup && faceIDEnabled && !faceIdFailed;
    const shouldShowPasswordUnlock = !isUnlocked && !shouldShowFaceIdSetup && (!faceIDEnabled || faceIdFailed);

    useEffect(() => {
        mark('vault.gates', {
            lockState,
            faceIDConfigured,
            faceIDEnabled,
            faceIdFailed,
            shouldShowFaceIdSetup,
            shouldShowApp,
            shouldShowFaceIdUnlock,
            shouldShowPasswordUnlock,
        });
    }, [faceIDConfigured, faceIDEnabled, faceIdFailed, lockState, shouldShowApp, shouldShowFaceIdSetup, shouldShowFaceIdUnlock, shouldShowPasswordUnlock]);

    useEffect(() => {
        const wasUnlocked = previousLockStateRef.current === 'unlocked';
        previousLockStateRef.current = lockState;

        if (lockState !== 'unlocked' || wasUnlocked || !faceIDConfigured) {
            return;
        }

        const target = hrefForLastAppTarget(readLastAppTarget(localCache));
        const state = navigationRef.getRootState?.() || navigationRef.getState?.();
        const routeName = routeNameForNavigationState(state);
        const currentTarget = lastAppTargetForNavigationState(state);
        const isCurrentPeerChat = currentTarget?.route === '/chat' && !!currentTarget.chatPeer;
        const shouldReplace = !isCurrentPeerChat && (!routeName || routeName === 'index' || routeName === 'unlockwithfaceid' || routeName === 'unlockwithpassword' || routeName === 'chat' || routeName === 'camera' || routeName === 'wallet');
        const targetName = typeof target === 'string' ? target.slice(1) : 'chat/[peerchatpk]';
        if (shouldReplace && routeName !== targetName) {
            router.replace(target);
        }
    }, [faceIDConfigured, localCache, lockState, navigationRef, router]);

    return (
        <Stack
            screenOptions={{
                headerShown: false,
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
                contentStyle: { backgroundColor: theme?.background },
            }}
        >
            <Stack.Protected guard={shouldShowFaceIdSetup}>
                <Stack.Screen name="faceid" />
            </Stack.Protected>
            <Stack.Protected guard={shouldShowApp}>
                <Stack.Screen name="(app)" />
                <Stack.Screen name="qr" />
            </Stack.Protected>
            <Stack.Protected guard={shouldShowFaceIdUnlock}>
                <Stack.Screen name="unlockwithfaceid" />
            </Stack.Protected>
            <Stack.Protected guard={shouldShowPasswordUnlock}>
                <Stack.Screen name="unlockwithpassword" />
            </Stack.Protected>
        </Stack>
    );
}

export default function VaultLayout() {
    return (
        <WalletProvider>
            <TxDataProvider>
                <ChatProvider>
                    <PushProvider>
                        <PeerProvider>
                            <VaultContent />
                        </PeerProvider>
                    </PushProvider>
                </ChatProvider>
            </TxDataProvider>
        </WalletProvider>
    );
}
