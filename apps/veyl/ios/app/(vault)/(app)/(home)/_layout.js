import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef } from 'react';
import { useIsFocused } from 'expo-router/react-navigation';
import { usePathname } from 'expo-router';
import { readLastAppRoute, writeLastAppTarget } from '@glyphteck/shared/localdatacache';
import { useTheme } from '@/providers/themeprovider';
import { useVault } from '@/providers/vaultprovider';
import { HomePager as HomeTabs } from '@/lib/homepager';
import { HOME_TAB_NAMES, homeTabForLastAppRoute, isHomeTabRootPath, targetForHomeTab, warmHomeTab } from '@/lib/hometabs';
import MainMenu from '@/components/mainmenu';

export default function TabsLayout() {
    const { theme, isDark } = useTheme();
    const { localCache } = useVault();
    const focused = useIsFocused();
    const pathname = usePathname();
    const tabSwipeEnabled = focused && isHomeTabRootPath(pathname);
    const initialRouteNameRef = useRef(homeTabForLastAppRoute(readLastAppRoute(localCache)));
    const savedInitialRouteRef = useRef(false);
    const saveHomeRoute = useCallback(
        (name) => {
            if (!savedInitialRouteRef.current) {
                savedInitialRouteRef.current = true;
                return;
            }
            const target = targetForHomeTab(name);
            if (target) writeLastAppTarget(localCache, target);
        },
        [localCache]
    );

    return (
        <>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <HomeTabs
                initialRouteName={initialRouteNameRef.current}
                swipeEnabled={tabSwipeEnabled}
                tabBar={(props) => <MainMenu {...props} />}
                onRouteChange={saveHomeRoute}
                onWarmRoute={warmHomeTab}
                screenOptions={{
                    sceneStyle: { backgroundColor: theme?.background },
                }}
            >
                {HOME_TAB_NAMES.map((name) => (
                    <HomeTabs.Screen key={name} name={name} />
                ))}
            </HomeTabs>
        </>
    );
}
