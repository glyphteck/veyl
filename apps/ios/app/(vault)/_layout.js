import { useEffect, useLayoutEffect, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
import { readResumeTarget } from '@veyl/shared/cache/localdata';
import { hrefForResumeTarget } from '@veyl/shared/navigation/resume';

import { WalletProvider } from '@/providers/walletprovider';
import { TxDataProvider } from '@/providers/txdataprovider';
import { ChatProvider } from '@/providers/chatprovider';
import { PeerProvider } from '@/providers/peerprovider';
import { PushProvider } from '@/providers/pushprovider';
import { useTheme } from '@/providers/themeprovider';
import { useVault } from '@/providers/vaultprovider';
import { mark } from '@/lib/diagnostics';
import { stackScreenOptions } from '@/lib/navigation/stackoptions';

function VaultContent() {
    const { theme } = useTheme();
    const router = useRouter();
    const { lockState, faceIdFailed, localCache, faceIdChoiceReady, faceIdConfigured, faceIdEnabled } = useVault();
    const previousLockStateRef = useRef(lockState);

    const isUnlocked = lockState === 'unlocked';
    const shouldShowFaceIdSetup = isUnlocked && faceIdChoiceReady && !faceIdConfigured;
    const shouldShowApp = isUnlocked && faceIdChoiceReady && faceIdConfigured;
    const shouldShowFaceIdUnlock = !isUnlocked && faceIdChoiceReady && !shouldShowFaceIdSetup && faceIdEnabled && !faceIdFailed;
    const shouldShowPasswordUnlock = !isUnlocked && faceIdChoiceReady && !shouldShowFaceIdSetup && (!faceIdEnabled || faceIdFailed);

    useEffect(() => {
        mark('vault.gates', {
            lockState,
            faceIDConfigured: faceIdConfigured,
            faceIDEnabled: faceIdEnabled,
            faceIdChoiceReady,
            faceIdFailed,
            shouldShowFaceIdSetup,
            shouldShowApp,
            shouldShowFaceIdUnlock,
            shouldShowPasswordUnlock,
        });
    }, [faceIdChoiceReady, faceIdConfigured, faceIdEnabled, faceIdFailed, lockState, shouldShowApp, shouldShowFaceIdSetup, shouldShowFaceIdUnlock, shouldShowPasswordUnlock]);

    useLayoutEffect(() => {
        const wasUnlocked = previousLockStateRef.current === 'unlocked';
        previousLockStateRef.current = lockState;

        if (lockState !== 'unlocked' || wasUnlocked || !faceIdConfigured) {
            return;
        }

        const target = readResumeTarget(localCache);
        const href = hrefForResumeTarget(target);
        mark('route.cache.read', { route: target?.route || '' });
        router.replace(href, { withAnchor: true });
    }, [faceIdConfigured, localCache, lockState, router]);

    return (
        <Stack screenOptions={stackScreenOptions(theme)}>
            <Stack.Protected guard={shouldShowFaceIdSetup}>
                <Stack.Screen name="faceid" />
            </Stack.Protected>
            <Stack.Protected guard={shouldShowApp}>
                <Stack.Screen name="(app)" options={{ animation: 'none' }} />
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
