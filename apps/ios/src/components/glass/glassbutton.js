import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import GlassView from '@/components/glass/glassview';
import { disabledGlassTint } from '@/lib/colors';
import { useTheme } from '@/providers/themeprovider';
import { tap } from '@/lib/tap';
import { resolveGlassEffectStyle } from '@/lib/glass';
import Icon from '@/components/icon';

export default function GlassButton({
    onPress,
    label,
    icon: IconComponent,
    iconSide = 'left',
    accent = false,
    disabled = false,
    color,
    tintColor,
    children,
    style,
    glassStyle,
    glassEffectStyle,
    pressableStyle,
    textStyle,
    hitSlop,
    height = 54,
}) {
    const { theme } = useTheme();
    const scale = useSharedValue(1);
    const press = tap({ value: scale, disabled, onPress, hapticIn: 'light' });
    const animStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));
    const radius = Math.round(height / 2);
    const resolvedTintColor = tintColor ?? (disabled ? disabledGlassTint(theme) : accent ? theme.glassForeground : theme.glassBackground);
    const resolvedColor = color ?? (disabled ? theme.muted : accent ? theme.background : theme.foreground);
    const resolvedGlassEffectStyle = resolveGlassEffectStyle(glassEffectStyle);

    return (
        <Pressable {...press} disabled={disabled} hitSlop={hitSlop} style={pressableStyle}>
            <Animated.View style={[{ overflow: 'hidden', borderRadius: radius }, style, animStyle]}>
                <GlassView
                    glassEffectStyle={resolvedGlassEffectStyle}
                    tintColor={resolvedTintColor}
                    style={[
                        {
                            minHeight: height,
                            borderRadius: radius,
                            paddingHorizontal: 20,
                            alignItems: 'center',
                            justifyContent: 'center',
                        },
                        glassStyle,
                    ]}
                >
                    {children ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>{children}</View>
                    ) : (
                        <View style={{ flexDirection: iconSide === 'right' ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            {IconComponent ? <Icon icon={IconComponent} size={20} color={resolvedColor} /> : null}
                            <Text numberOfLines={1} style={[{ color: resolvedColor, fontSize: 18, fontWeight: '900' }, textStyle]}>
                                {label}
                            </Text>
                        </View>
                    )}
                </GlassView>
            </Animated.View>
        </Pressable>
    );
}
