import '@/lib/console';
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
import { Stack, useGlobalSearchParams } from 'expo-router';
import { usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { hasCurrentCommunityRules } from '@veyl/shared/community';
import { cleanText } from '@veyl/shared/utils/text';
import { cloud } from '@/lib/cloud';
import { KeyboardRootProvider } from '@/components/keyboardscroll';
import { installDiagnostics, mark } from '@/lib/diagnostics';
import { stackScreenOptions } from '@/lib/navigation/stackoptions';
import { writePendingInvite } from '@/lib/invite';

installDiagnostics();
void SplashScreen.preventAutoHideAsync();

const SHEET_ROUTES = new Set(['quicklogin']);

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
    const route = cleanText(pathname);
    if (!route) return '';
    if (SAFE_ROUTES.has(route)) return route;
    if (route.startsWith('/chat/')) return '/chat';
    if (route.startsWith('/qr')) return '/qr';
    return 'dynamic';
}

function AppContent() {
    const { theme } = useTheme();
    const user = useUser();
    const { vaultReady, vault, lockState, touch } = useVault();
    const pathname = usePathname();
    const params = useGlobalSearchParams();
    const [authReady, setAuthReady] = useState(!!cloud.auth.user);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (authReady) return;
        const unsub = cloud.auth.watch(() => {
            setAuthReady(true);
            unsub();
        });
        return unsub;
    }, []);

    useEffect(() => {
        mark('route.path', { pathname, route: safeRoute(pathname) });
    }, [pathname]);

    useEffect(() => {
        if (pathname !== '/' && !pathname.startsWith('/qr')) return;
        void writePendingInvite(params);
    }, [params, pathname]);

    const hasAuthSession = !!cloud.auth.user || !!user.uid;
    const signedIn = !!user.uid;
    const routeReady = !hasAuthSession || (signedIn && user.profileReady && user.settingsReady && vaultReady);
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
    const hasVault = !!vault;
    const acceptedRules = hasCurrentCommunityRules(user);
    const onboardingComplete = hasUsername && hasAvatarEntry && hasVault && acceptedRules;
    const showLogin = !signedIn || !routeReady;
    const showAuthed = signedIn && routeReady;

    useEffect(() => {
        mark('app.gates', {
            authReady,
            hasAuthSession,
            signedIn,
            profileReady: !!user.profileReady,
            settingsReady: !!user.settingsReady,
            vaultReady: !!vaultReady,
            lockState,
            routeReady,
            loaded,
            ready,
            onboardingComplete,
        });
    }, [authReady, hasAuthSession, loaded, lockState, onboardingComplete, ready, routeReady, vaultReady, signedIn, user.profileReady, user.settingsReady]);

    if (!ready) {
        return null;
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }} onTouchStart={touch}>
            <Stack screenOptions={stackScreenOptions(theme, SHEET_ROUTES)}>
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
