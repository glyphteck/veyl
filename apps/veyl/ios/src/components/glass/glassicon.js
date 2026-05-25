import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { alpha } from '@/lib/colors';
import { useTheme } from '@/providers/themeprovider';
import { tap } from '@/lib/tap';
import { resolveGlassEffectStyle } from '@/lib/glass';

export default function GlassIcon({
    icon,
    onPress,
    disabled = false,
    accent = false,
    visible = true,
    duration = 160,
    size = 56,
    iconSize = size * 0.5,
    rounded = 'full',
    color,
    tintColor,
    style,
    glassStyle,
    glassEffectStyle,
    pressableStyle,
    drift,
}) {
    const { theme } = useTheme();
    const scale = useSharedValue(1);
    const iconOpacity = useSharedValue(visible ? 1 : 0);
    const inset = Math.max(0, (size - iconSize) / 2);
    const resolvedTintColor = tintColor ?? (accent ? alpha(theme.foreground, disabled ? 20 : 100) : theme.background);
    const resolvedColor = color ?? (disabled ? theme.muted : accent ? theme.background : theme.foreground);
    const resolvedGlassEffectStyle = resolveGlassEffectStyle(glassEffectStyle, visible, duration);
    const borderRadius = rounded === 'full' ? 99 : rounded;
    const press = tap({
        value: scale,
        disabled: disabled || !visible,
        onPress,
        drift,
    });
    const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
    const iconStyle = useAnimatedStyle(() => ({ opacity: iconOpacity.value }));

    useEffect(() => {
        iconOpacity.value = withTiming(visible ? 1 : 0, { duration });
    }, [duration, iconOpacity, visible]);

    return (
        <Pressable {...press} disabled={disabled || !visible} style={pressableStyle}>
            <Animated.View
                style={[
                    {
                        width: size,
                        height: size,
                        borderRadius,
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                    },
                    animStyle,
                    style,
                ]}
            >
                <GlassView glassEffectStyle={resolvedGlassEffectStyle} tintColor={resolvedTintColor} style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius }, glassStyle]}>
                    <Animated.View style={iconStyle}>
                        <Icon icon={icon} size={iconSize} color={resolvedColor} style={{ margin: inset }} />
                    </Animated.View>
                </GlassView>
            </Animated.View>
        </Pressable>
    );
}
