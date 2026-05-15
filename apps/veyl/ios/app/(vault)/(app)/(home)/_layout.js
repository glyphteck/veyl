import { StatusBar } from 'expo-status-bar';
import { useTheme } from '@/providers/themeprovider';
import { Pager } from '@/lib/pagernav';
import MainMenu from '@/components/mainmenu';

export default function TabsLayout() {
    const { theme, isDark } = useTheme();

    return (
        <>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Pager tabBar={(props) => <MainMenu {...props} />} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme?.background } }}>
                <Pager.Screen name="chatlist" />
                <Pager.Screen name="camera" />
                <Pager.Screen name="wallet" />
                <Pager.Screen name="profile" />
            </Pager>
        </>
    );
}
