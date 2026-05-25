import { Stack } from 'expo-router';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { hasCurrentCommunityRules } from '@/lib/community';

export default function OnboardingLayout() {
    const { theme } = useTheme();
    const user = useUser();
    const { encSeed } = useVault();

    const hasUsername = !!user.username;
    const hasAvatarEntry = !!user.hasAvatarEntry;
    const hasSeed = !!encSeed;
    const needsAvatar = hasUsername && !hasAvatarEntry;
    const acceptedRules = hasCurrentCommunityRules(user);
    const needsRules = hasUsername && hasAvatarEntry && !acceptedRules;
    const needsPassword = hasUsername && hasAvatarEntry && acceptedRules && !hasSeed;

    return (
        <Stack
            screenOptions={{
                headerShown: false,
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
                contentStyle: { backgroundColor: theme?.background },
            }}
        >
            <Stack.Protected guard={!hasUsername}>
                <Stack.Screen name="getusername" />
            </Stack.Protected>
            <Stack.Protected guard={needsAvatar}>
                <Stack.Screen name="getavatar" />
            </Stack.Protected>
            <Stack.Protected guard={needsRules}>
                <Stack.Screen name="community" />
            </Stack.Protected>
            <Stack.Protected guard={needsPassword && acceptedRules}>
                <Stack.Screen name="getpassword" />
            </Stack.Protected>
            <Stack.Protected guard={needsPassword && acceptedRules}>
                <Stack.Screen
                    name="passwordrules"
                    options={{
                        presentation: 'formSheet',
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: 'fitToContents',
                        contentStyle: { backgroundColor: 'transparent' },
                    }}
                />
            </Stack.Protected>
        </Stack>
    );
}
