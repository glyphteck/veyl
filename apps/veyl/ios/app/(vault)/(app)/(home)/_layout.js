import { StatusBar } from 'expo-status-bar';
import { useTheme } from '@/providers/themeprovider';
import { Pager } from '@/lib/pagernav';
import { warmCamera } from '@/lib/camerawarm';
import MainMenu from '@/components/mainmenu';

function warmHomeRoute(name) {
    if (name === 'camera') warmCamera();
}

export default function TabsLayout() {
    const { theme, isDark } = useTheme();

    return (
        <>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Pager tabBar={(props) => <MainMenu {...props} />} onWarmRoute={warmHomeRoute} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme?.background } }}>
                <Pager.Screen name="chatlist" />
                <Pager.Screen name="camera" />
                <Pager.Screen name="wallet" />
                <Pager.Screen name="settings" />
            </Pager>
        </>
    );
}
