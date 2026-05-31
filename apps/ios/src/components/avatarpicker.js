import { useCallback, useMemo } from 'react';
import { Alert, Animated, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { X } from 'lucide-react-native';
import { avatarSourceKey } from '@veyl/shared/avatar';
import { useTap } from '@/lib/tap';
import { usePop } from '@/lib/pop';
import { useTheme } from '@/providers/themeprovider';
import Avatar from './avatar';
import Icon from './icon';

export default function AvatarPicker({ size = 88, source, onPick, onRemove, disabled = false, removeDisabled = false, showRemove = false, style }) {
    const { theme } = useTheme();
    const sourceKey = avatarSourceKey(source);
    const canRemove = !!sourceKey && showRemove && typeof onRemove === 'function';
    const removeOpen = canRemove && !disabled && !removeDisabled;
    const removeMetrics = useMemo(() => {
        const sizeRatio = Math.max(1, size) / 48;
        const buttonScale = Math.sqrt(sizeRatio);
        const iconScale = Math.pow(sizeRatio, 0.25);
        const button = Math.round(22 * buttonScale);
        const ring = Math.max(2, Math.round(2 * buttonScale));
        const icon = Math.round(14 * iconScale);
        const outer = button + ring * 2;
        const center = size * 0.85355;

        return {
            button,
            icon,
            ring,
            outer,
            left: center - outer / 2,
            top: size * 0.14645 - outer / 2,
        };
    }, [size]);
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
    const removeFeedback = useTap({
        disabled: !removeOpen,
        onPress: onRemove,
        hapticIn: 'selection',
    });
    const removePop = usePop({ show: removeOpen, from: 0.58, enterBounce: 16, exitDuration: 130 });
    const removeOpacityStyle = useMemo(() => ({ opacity: removePop.value }), [removePop.value]);

    return (
        <View style={[{ width: size, height: size }, style]}>
            <Pressable {...props} disabled={disabled} style={{ width: size, height: size }}>
                <Animated.View style={{ transform: [{ scale }] }}>
                    <Avatar pointerEvents="none" size={size} source={source} />
                </Animated.View>
            </Pressable>
            {typeof onRemove === 'function' ? (
                <Pressable
                    {...removeFeedback.props}
                    disabled={!removeOpen}
                    hitSlop={8}
                    pointerEvents={removePop.pointerEvents}
                    style={{
                        position: 'absolute',
                        left: removeMetrics.left,
                        top: removeMetrics.top,
                        width: removeMetrics.outer,
                        height: removeMetrics.outer,
                        borderRadius: removeMetrics.outer / 2,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Animated.View style={[removePop.childStyle, removeOpacityStyle]}>
                        <Animated.View style={{ transform: [{ scale: removeFeedback.scale }] }}>
                            <View style={{ width: removeMetrics.outer, height: removeMetrics.outer, borderRadius: removeMetrics.outer / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
                                <View
                                    style={{
                                        width: removeMetrics.button,
                                        height: removeMetrics.button,
                                        borderRadius: removeMetrics.button / 2,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        backgroundColor: theme.destructive,
                                    }}
                                >
                                    <Icon icon={X} size={removeMetrics.icon} strokeWidth={4} color={theme.background} />
                                </View>
                            </View>
                        </Animated.View>
                    </Animated.View>
                </Pressable>
            ) : null}
        </View>
    );
}
