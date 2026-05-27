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
import { usePathname } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import * as SplashScreen from 'expo-splash-screen';
import { auth } from '@/lib/firebase';
import { hasCurrentCommunityRules } from '@/lib/community';
import { KeyboardRootProvider } from '@/components/keyboardscroll';
import { installDiagnostics, mark } from '@/lib/diagnostics';

installDiagnostics();
void SplashScreen.preventAutoHideAsync();

const SAFE_ROUTES = new Set([
    '/',
    '/login',
    '/quicklogin',
    '/newaccount',
    '/faceid',
    '/unlockwithfaceid',
    '/unlockwithpassword',
    '/chat',
    '/camera',
    '/wallet',
    '/peerselector',
    '/settings',
    '/fundwallet',
    '/userscan',
    '/withdraw',
    '/transfer',
    '/deleteaccount',
    '/exportwallet',
    '/qr',
]);

function safeRoute(pathname) {
    const route = typeof pathname === 'string' ? pathname.trim() : '';
    if (!route) return '';
    if (SAFE_ROUTES.has(route)) return route;
    if (route.startsWith('/chat/')) return '/chat';
    if (route.startsWith('/qr')) return '/qr';
    return 'dynamic';
}

function AppContent() {
    const { theme } = useTheme();
    const user = useUser();
    const { seedReady, encSeed, lockState, touch } = useVault();
    const pathname = usePathname();
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

    useEffect(() => {
        mark('route.path', { pathname, route: safeRoute(pathname) });
    }, [pathname]);

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

    useEffect(() => {
        mark('app.gates', {
            authReady,
            hasAuthSession,
            signedIn,
            profileReady: !!user.profileReady,
            settingsReady: !!user.settingsReady,
            seedReady: !!seedReady,
            lockState,
            routeReady,
            loaded,
            ready,
            onboardingComplete,
        });
    }, [authReady, hasAuthSession, loaded, lockState, onboardingComplete, ready, routeReady, seedReady, signedIn, user.profileReady, user.settingsReady]);

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
