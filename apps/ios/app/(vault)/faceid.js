import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, BackHandler, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GlassButton from '@/components/glass/glassbutton';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { clearFaceIdPassword, FaceIdIcon } from '@/lib/faceid';
import { useTap } from '@/lib/tap';

export default function FaceIdScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const user = useUser();
    const [isSaving, setIsSaving] = useState(false);
    const canSubmit = !!user.uid && user.settingsReady && !isSaving;
    const secondaryFeedback = useTap({ disabled: !canSubmit, onPress: () => setPreference(false) });

    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
        return () => sub.remove();
    }, []);

    const setPreference = useCallback(
        async (enabled) => {
            if (!canSubmit) return;
            setIsSaving(true);
            try {
                await user.updateSettings({ faceID: enabled });

                if (!enabled && user.uid) {
                    const cleared = await clearFaceIdPassword(user.uid).catch((err) => {
                        console.warn('failed to clear face id password', err);
                        return false;
                    });

                    if (!cleared) {
                        console.warn('failed to clear face id password');
                    }
                }
            } catch (err) {
                console.warn('failed to save face id preference', err);
                Alert.alert('Face ID not updated', enabled ? 'Could not enable Face ID on this device.' : 'Could not skip Face ID setup right now.');
            } finally {
                setIsSaving(false);
            }
        },
        [canSubmit, user]
    );

    return (
        <View style={{ flex: 1 }}>
            <View style={{ paddingTop: insets.top + 64, paddingHorizontal: 24, alignItems: 'center', gap: 64 }}>
                <FaceIdIcon size={256} color={theme.foreground} />
                <View style={{ alignItems: 'center', gap: 12 }}>
                    <Text style={{ fontSize: 36, fontWeight: '900', color: theme.foreground, textAlign: 'center' }}>use Face ID to unlock your vault?</Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: theme.muted, textAlign: 'center' }}>using Face ID is faster and more secure</Text>
                </View>
            </View>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: '14%', alignItems: 'center', gap: 12 }}>
                <GlassButton onPress={() => setPreference(true)} label="use Face ID" accent disabled={!canSubmit} style={{ width: 256 }} />
                <Pressable {...secondaryFeedback.props} disabled={!canSubmit} hitSlop={8}>
                    <Animated.View style={{ transform: [{ scale: secondaryFeedback.scale }] }}>
                        <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '600' }}>maybe later</Text>
                    </Animated.View>
                </Pressable>
            </View>
        </View>
    );
}
