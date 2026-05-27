import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Stack, useNavigationContainerRef } from 'expo-router';
import { writeLastAppTarget } from '@glyphteck/shared/localdatacache';
import { lastAppTargetForNavigationState } from '@/lib/approute';
import { useTheme } from '@/providers/themeprovider';
import { useVault } from '@/providers/vaultprovider';

export default function AppLayout() {
    const { theme } = useTheme();
    const navigationRef = useNavigationContainerRef();
    const { localCache, lockState } = useVault();
    const cacheRef = useRef(localCache);
    const unlockedRef = useRef(lockState === 'unlocked');
    const wasUnlockedRef = useRef(lockState === 'unlocked');
    cacheRef.current = localCache;
    unlockedRef.current = lockState === 'unlocked';

    const saveCurrentRoute = useCallback((options = {}) => {
        if (!options.force && !unlockedRef.current) return;
        const cache = cacheRef.current;
        const state = navigationRef.getRootState?.() || navigationRef.getState?.();
        const target = lastAppTargetForNavigationState(state);
        if (!target) return;
        writeLastAppTarget(cache, target);
        void cache?.flush?.();
    }, [navigationRef]);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (nextState) => {
            if (nextState !== 'active') saveCurrentRoute();
        });

        return () => {
            saveCurrentRoute();
            sub?.remove?.();
        };
    }, [saveCurrentRoute]);

    useEffect(() => {
        if (wasUnlockedRef.current && lockState !== 'unlocked') {
            saveCurrentRoute({ force: true });
        }
        wasUnlockedRef.current = lockState === 'unlocked';
    }, [lockState, saveCurrentRoute]);

    return (
        <Stack
            screenOptions={{
                headerShown: false,
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
                contentStyle: { backgroundColor: theme?.background },
            }}
        >
            <Stack.Screen name="(home)" />
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
