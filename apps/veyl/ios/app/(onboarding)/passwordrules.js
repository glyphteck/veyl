import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GlassButton from '@/components/glass/glassbutton';
import { useTheme } from '@/providers/themeprovider';

export default function PasswordRulesScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();

    return (
        <View style={{ backgroundColor: 'transparent', paddingHorizontal: 24, paddingTop: 24, gap: 14 }}>
            <Text style={{ fontSize: 32, fontWeight: '900', color: theme.foreground }}>about passwords</Text>
            <Text style={{ fontSize: 16, fontWeight: '500', color: theme.foreground }}>
                it is always better to use computer generated passwords. it is hard for a human to create randomness, which is the best kind of password.
            </Text>
            <Text style={{ fontSize: 18, fontWeight: '500', color: theme.foreground }}>• Use 12 to 64 characters.</Text>
            <Text style={{ fontSize: 18, fontWeight: '500', color: theme.foreground }}>• Most visible letters, numbers, symbols, emoji, and spaces are allowed.</Text>
            <Text style={{ fontSize: 18, fontWeight: '500', color: theme.foreground }}>• Spaces work inside the password, but not at the beginning or end.</Text>
            <Text style={{ fontSize: 18, fontWeight: '500', color: theme.foreground }}>• Tabs, newlines, and other invisible or control characters are not allowed.</Text>

            <GlassButton onPress={() => router.back()} label="ok" accent style={{ paddingTop: 24 }} />
        </View>
    );
}
