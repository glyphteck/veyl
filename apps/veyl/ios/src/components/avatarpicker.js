import { useCallback } from 'react';
import { Alert, Animated, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTap } from '@/lib/tap';
import Avatar from './avatar';

export default function AvatarPicker({ size = 88, source, onPick, disabled = false, style }) {
    const handlePickAvatar = useCallback(async () => {
        if (disabled) return;
        try {
            const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
            const perm = existing.granted ? existing : await ImagePicker.requestMediaLibraryPermissionsAsync();

            if (!perm.granted) {
                Alert.alert('Permission needed', 'Please allow photo access to choose an avatar.');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.9,
            });

            if (result.canceled || !result.assets?.length) return;
            onPick?.(result.assets[0]);
        } catch (err) {
            console.warn('avatar picker failed', err);
        }
    }, [disabled, onPick]);

    const { scale, props } = useTap({
        disabled,
        onPress: handlePickAvatar,
        hapticIn: 'selection',
    });

    return (
        <View style={style}>
            <Pressable {...props} disabled={disabled} style={{ width: size, height: size }}>
                <Animated.View style={{ transform: [{ scale }] }}>
                    <Avatar pointerEvents="none" size={size} source={source} />
                </Animated.View>
            </Pressable>
        </View>
    );
}
