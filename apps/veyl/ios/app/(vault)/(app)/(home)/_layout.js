import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef } from 'react';
import { readLastAppRoute, writeLastAppTarget } from '@glyphteck/shared/localdatacache';
import { useTheme } from '@/providers/themeprovider';
import { useVault } from '@/providers/vaultprovider';
import { tabForLastAppRoute } from '@/lib/approute';
import { Pager } from '@/lib/pagernav';
import { warmCamera } from '@/lib/camera/warming';
import MainMenu from '@/components/mainmenu';

function warmHomeRoute(name) {
    if (name === 'camera') warmCamera();
}

function targetForHomeRoute(name) {
    if (name === 'camera') return { route: '/camera' };
    if (name === 'wallet') return { route: '/wallet' };
    if (name === 'chat') return { route: '/chat' };
    return null;
}

export default function TabsLayout() {
    const { theme, isDark } = useTheme();
    const { localCache } = useVault();
    const initialRouteNameRef = useRef(tabForLastAppRoute(readLastAppRoute(localCache)));
    const savedInitialRouteRef = useRef(false);
    const saveHomeRoute = useCallback(
        (name) => {
            if (!savedInitialRouteRef.current) {
                savedInitialRouteRef.current = true;
                return;
            }
            const target = targetForHomeRoute(name);
            if (target) writeLastAppTarget(localCache, target);
        },
        [localCache]
    );

    return (
        <>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Pager initialRouteName={initialRouteNameRef.current} tabBar={(props) => <MainMenu {...props} />} onRouteChange={saveHomeRoute} onWarmRoute={warmHomeRoute} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme?.background } }}>
                <Pager.Screen name="chat" />
                <Pager.Screen name="camera" />
                <Pager.Screen name="wallet" />
                <Pager.Screen name="settings" />
            </Pager>
        </>
    );
}
