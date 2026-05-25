import { Stack } from 'expo-router';
import { useTheme } from '@/providers/themeprovider';

export default function AppLayout() {
    const { theme } = useTheme();

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
                name="currentchat"
                options={{
                    freezeOnBlur: true,
                }}
            />
            <Stack.Screen name="[username]" />
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
