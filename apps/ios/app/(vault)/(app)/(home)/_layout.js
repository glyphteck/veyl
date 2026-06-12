import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef } from 'react';
import { usePathname } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { readResumeRoute, writeResumeTarget } from '@veyl/shared/cache/localdata';
import { useTheme } from '@/providers/themeprovider';
import { useVault } from '@/providers/vaultprovider';
import { HomePager as HomeTabs } from '@/lib/navigation/homepager';
import { HOME_TAB_NAMES, homeTabForResumeRoute, isHomeTabRootPath, targetForHomeTab, warmHomeTab } from '@/lib/navigation/hometabs';
import MainMenu from '@/components/mainmenu';

function renderMainMenu(props) {
    return <MainMenu {...props} />;
}

export default function TabsLayout() {
    const { theme } = useTheme();
    const { localCache } = useVault();
    const focused = useIsFocused();
    const pathname = usePathname();
    const tabSwipeEnabled = focused && isHomeTabRootPath(pathname);
    const initialRouteNameRef = useRef(homeTabForResumeRoute(readResumeRoute(localCache)));
    const savedInitialRouteRef = useRef(false);
    const screenOptions = useMemo(
        () => ({
            sceneStyle: { backgroundColor: theme?.background },
        }),
        [theme?.background]
    );
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
            <StatusBar style="auto" />
            <HomeTabs
                initialRouteName={initialRouteNameRef.current}
                swipeEnabled={tabSwipeEnabled}
                tabBar={renderMainMenu}
                onRouteChange={saveHomeRoute}
                onWarmRoute={warmHomeTab}
                screenOptions={screenOptions}
            >
                {HOME_TAB_NAMES.map((name) => (
                    <HomeTabs.Screen key={name} name={name} />
                ))}
            </HomeTabs>
        </>
    );
}
