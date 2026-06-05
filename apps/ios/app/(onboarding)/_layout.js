import { Stack } from 'expo-router';
import { hasCurrentCommunityRules } from '@veyl/shared/community';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { stackScreenOptions } from '@/lib/navigation/stackoptions';

const SHEET_ROUTES = new Set(['passwordrules']);

export default function OnboardingLayout() {
    const { theme } = useTheme();
    const user = useUser();
    const { vault } = useVault();

    const hasUsername = !!user.username;
    const hasAvatarEntry = !!user.hasAvatarEntry;
    const hasVault = !!vault;
    const needsAvatar = hasUsername && !hasAvatarEntry;
    const acceptedRules = hasCurrentCommunityRules(user);
    const needsRules = hasUsername && hasAvatarEntry && !acceptedRules;
    const needsPassword = hasUsername && hasAvatarEntry && acceptedRules && !hasVault;

    return (
        <Stack screenOptions={stackScreenOptions(theme, SHEET_ROUTES)}>
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
