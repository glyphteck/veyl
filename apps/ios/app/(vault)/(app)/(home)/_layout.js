import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef } from 'react';
import { useIsFocused, usePathname } from 'expo-router';
import { readResumeRoute, writeResumeTarget } from '@veyl/shared/cache/localdata';
import { useTheme } from '@/providers/themeprovider';
import { useVault } from '@/providers/vaultprovider';
import { HomePager as HomeTabs } from '@/lib/navigation/homepager';
import { HOME_TAB_NAMES, homeTabForResumeRoute, isHomeTabRootPath, targetForHomeTab, warmHomeTab } from '@/lib/navigation/hometabs';
import MainMenu from '@/components/mainmenu';

export default function TabsLayout() {
    const { theme, isDark } = useTheme();
    const { localCache } = useVault();
    const focused = useIsFocused();
    const pathname = usePathname();
    const tabSwipeEnabled = focused && isHomeTabRootPath(pathname);
    const initialRouteNameRef = useRef(homeTabForResumeRoute(readResumeRoute(localCache)));
    const savedInitialRouteRef = useRef(false);
    const saveHomeRoute = useCallback(
        (name) => {
            if (!savedInitialRouteRef.current) {
                savedInitialRouteRef.current = true;
                return;
            }
            const target = targetForHomeTab(name);
            if (target) writeResumeTarget(localCache, target);
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
