import { Stack } from 'expo-router';

import { WalletProvider } from '@/providers/walletprovider';
import { TxDataProvider } from '@/providers/txdataprovider';
import { ChatProvider } from '@/providers/chatprovider';
import { PeerProvider } from '@/providers/peerprovider';
import { PushProvider } from '@/providers/pushprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';

function VaultContent() {
    const { theme } = useTheme();
    const { lockState, faceIdFailed } = useVault();
    const user = useUser();

    const faceIDConfigured = user.settingsReady && typeof user.settings?.faceID === 'boolean';
    const faceIDEnabled = faceIDConfigured && user.settings.faceID === true;
    const isUnlocked = lockState === 'unlocked';
    const shouldShowFaceIdSetup = isUnlocked && !faceIDConfigured;
    const shouldShowApp = isUnlocked && faceIDConfigured;
    const shouldShowFaceIdUnlock = !isUnlocked && !shouldShowFaceIdSetup && faceIDEnabled && !faceIdFailed;
    const shouldShowPasswordUnlock = !isUnlocked && !shouldShowFaceIdSetup && (!faceIDEnabled || faceIdFailed);

    return (
        <Stack
            screenOptions={{
                headerShown: false,
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
                animationDuration: 500,
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
