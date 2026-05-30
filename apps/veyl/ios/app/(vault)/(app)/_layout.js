import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { writeLastAppTarget } from '@glyphteck/shared/localdatacache';
import { lastAppTargetForPathname } from '@/lib/approute';
import { useTheme } from '@/providers/themeprovider';
import { useVault } from '@/providers/vaultprovider';
import { mark } from '@/lib/diagnostics';
import { stackScreenOptions } from '@/lib/stackoptions';

export const unstable_settings = {
    initialRouteName: '(home)',
};

const SHEET_ROUTES = new Set(['userscan', 'fundwallet', 'fundinginfo', 'withdraw', 'withdrawalinfo', 'transfer', 'peerselector', 'sendphoto', 'sharemedia']);

export default function AppLayout() {
    const { theme } = useTheme();
    const pathname = usePathname();
    const { localCache, lockState } = useVault();
    const cacheRef = useRef(localCache);
    const pathnameRef = useRef(pathname);
    const lastTargetRef = useRef(null);
    const unlockedRef = useRef(lockState === 'unlocked');
    const wasUnlockedRef = useRef(lockState === 'unlocked');
    cacheRef.current = localCache;
    pathnameRef.current = pathname;
    unlockedRef.current = lockState === 'unlocked';

    useEffect(() => {
        const target = lastAppTargetForPathname(pathname);
        if (!target) return;
        lastTargetRef.current = target;
    }, [pathname]);

    const saveCurrentRoute = useCallback((options = {}) => {
        if (!options.force && !unlockedRef.current) return;
        const cache = cacheRef.current;
        const target = lastTargetRef.current || lastAppTargetForPathname(pathnameRef.current);
        if (!target) return;
        mark('route.cache.write', { route: target.route, reason: options.reason || 'leave' });
        writeLastAppTarget(cache, target);
        void cache?.flush?.();
    }, []);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (nextState) => {
            if (nextState !== 'active') saveCurrentRoute({ reason: nextState });
        });

        return () => {
            saveCurrentRoute({ reason: 'unmount' });
            sub?.remove?.();
        };
    }, [saveCurrentRoute]);

    useEffect(() => {
        if (wasUnlockedRef.current && lockState !== 'unlocked') {
            saveCurrentRoute({ force: true, reason: 'lock' });
        }
        wasUnlockedRef.current = lockState === 'unlocked';
    }, [lockState, saveCurrentRoute]);

    return (
        <Stack screenOptions={stackScreenOptions(theme, SHEET_ROUTES)}>
            <Stack.Screen name="(home)" options={{ animationTypeForReplace: 'pop' }} />
            <Stack.Screen name="community" />
            <Stack.Screen name="exportwallet" />
            <Stack.Screen name="blocked" />
            <Stack.Screen name="legal" />
            <Stack.Screen
                name="chat/[peerchatpk]/index"
                options={{
                    freezeOnBlur: true,
                }}
            />
            <Stack.Screen name="chat/[peerchatpk]/settings" />
            <Stack.Screen name="history" />
            <Stack.Screen
                name="userscan"
                options={{
                    presentation: 'formSheet',
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: 'fitToContents',
                    contentStyle: { backgroundColor: 'transparent' },
                }}
            />
            <Stack.Screen
                name="fundwallet"
                options={{
                    presentation: 'formSheet',
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: 'fitToContents',
                    contentStyle: { backgroundColor: 'transparent' },
                }}
            />
            <Stack.Screen
                name="fundinginfo"
                options={{
                    presentation: 'formSheet',
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: 'fitToContents',
                    contentStyle: { backgroundColor: 'transparent' },
                }}
            />
            <Stack.Screen
                name="withdraw"
                options={{
                    presentation: 'formSheet',
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: 'fitToContents',
                    contentStyle: { backgroundColor: 'transparent' },
                }}
            />
            <Stack.Screen
                name="withdrawalinfo"
                options={{
                    presentation: 'formSheet',
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: 'fitToContents',
                    contentStyle: { backgroundColor: 'transparent' },
                }}
            />
            <Stack.Screen name="deleteaccount" />
            <Stack.Screen
                name="transfer"
                options={{
                    presentation: 'formSheet',
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: 'fitToContents',
                    contentStyle: { backgroundColor: 'transparent' },
                }}
            />
            <Stack.Screen
                name="peerselector"
                options={{
                    presentation: 'formSheet',
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: [1],
                    contentStyle: { backgroundColor: theme?.background },
                }}
            />
            <Stack.Screen
                name="sendphoto"
                options={{
                    presentation: 'formSheet',
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: [0.85],
                    contentStyle: { backgroundColor: 'transparent' },
                }}
            />
            <Stack.Screen
                name="sharemedia"
                options={{
                    presentation: 'formSheet',
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: [0.85],
                    contentStyle: { backgroundColor: 'transparent' },
                }}
            />
        </Stack>
    );
}
