import '@/lib/polyfills';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '@/providers/themeprovider';
import { MenuProvider } from '@/providers/menuprovider';
import { AudioProvider } from '@/providers/audioprovider';
import { MediaViewerProvider } from '@/providers/mediaviewerprovider';
import { UserProvider, useUser } from '@/providers/userprovider';
import { BitcoinProvider } from '@/providers/bitcoinprovider';
import { VaultProvider, useVault } from '@/providers/vaultprovider';
import { Stack } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import * as SplashScreen from 'expo-splash-screen';
import { auth } from '@/lib/firebase';
import { hasCurrentCommunityRules } from '@/lib/community';
import { KeyboardRootProvider } from '@/components/keyboardscroll';

void SplashScreen.preventAutoHideAsync();

function AppContent() {
    const { theme } = useTheme();
    const user = useUser();
    const { seedReady, encSeed, touch } = useVault();
    const [authReady, setAuthReady] = useState(!!auth.currentUser);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (authReady) return;
        const unsub = onAuthStateChanged(auth, () => {
            setAuthReady(true);
            unsub();
        });
        return unsub;
    }, []);

    const hasAuthSession = !!auth.currentUser || !!user.uid;
    const signedIn = !!user.uid;
    const routeReady = !hasAuthSession || (signedIn && user.profileReady && user.settingsReady && seedReady);
    const loaded = authReady && (!hasAuthSession || routeReady);

    useEffect(() => {
        if (loaded && !ready) setReady(true);
    }, [loaded]);

    useEffect(() => {
        if (!ready) return;
        SplashScreen.hideAsync().catch(() => {});
    }, [ready]);

    const hasUsername = !!user.username;
    const hasAvatarEntry = !!user.hasAvatarEntry;
    const hasSeed = !!encSeed;
    const acceptedRules = hasCurrentCommunityRules(user);
    const onboardingComplete = hasUsername && hasAvatarEntry && hasSeed && acceptedRules;
    const showLogin = !signedIn || !routeReady;
    const showAuthed = signedIn && routeReady;

    if (!ready) {
        return null;
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }} onTouchStart={touch}>
            <Stack
                screenOptions={{
                    headerShown: false,
                    gestureEnabled: true,
                    fullScreenGestureEnabled: true,
                    animationDuration: 500,
                    contentStyle: { backgroundColor: theme?.background },
                }}
            >
                <Stack.Protected guard={showLogin}>
                    <Stack.Screen name="login" />
                    <Stack.Screen
                        name="quicklogin"
                        options={{
                            presentation: 'formSheet',
                            sheetGrabberVisible: true,
                            sheetAllowedDetents: 'fitToContents',
                            contentStyle: { backgroundColor: 'transparent' },
                        }}
                    />
                    <Stack.Screen name="newaccount" />
                </Stack.Protected>
                <Stack.Protected guard={showAuthed && onboardingComplete}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="(vault)" />
                </Stack.Protected>
                <Stack.Protected guard={showAuthed && !onboardingComplete}>
                    <Stack.Screen name="(onboarding)" />
                </Stack.Protected>
            </Stack>
        </View>
    );
}

export default function Root() {
    return (
        <ThemeProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardRootProvider>
                    <SafeAreaProvider>
                        <UserProvider>
                            <BitcoinProvider>
                                <VaultProvider>
                                    <AudioProvider>
                                        <MediaViewerProvider>
                                            <MenuProvider>
                                                <AppContent />
                                            </MenuProvider>
                                        </MediaViewerProvider>
                                    </AudioProvider>
                                </VaultProvider>
                            </BitcoinProvider>
                        </UserProvider>
                    </SafeAreaProvider>
                </KeyboardRootProvider>
            </GestureHandlerRootView>
        </ThemeProvider>
    );
}
