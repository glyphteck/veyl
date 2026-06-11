import { View } from 'react-native';
import { GlassView as NativeGlassView } from 'expo-glass-effect';

import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';

function resolveTintColor(theme, tintColor) {
    if (!tintColor || tintColor === theme.background || tintColor === theme.glassBackground) {
        return theme.glassBackground;
    }

    if (tintColor === theme.foreground || tintColor === theme.glassForeground) {
        return theme.glassForeground;
    }

    return tintColor;
}

function resolveFillColor(theme, tintColor) {
    if (!tintColor || tintColor === theme.background || tintColor === theme.glassBackground || tintColor === theme.glassBackgroundSoft) {
        return theme.background;
    }

    if (tintColor === theme.foreground || tintColor === theme.glassForeground) {
        return theme.foreground;
    }

    return tintColor;
}

function getBaseStyle(theme, tintColor, glassEffectStyle) {
    const glassStyle = typeof glassEffectStyle === 'string' ? glassEffectStyle : glassEffectStyle?.style;
    const backgroundColor = resolveFillColor(theme, tintColor);

    if (glassStyle === 'none') {
        return { backgroundColor: 'transparent' };
    }

    if (glassStyle === 'clear') {
        return { backgroundColor };
    }

    return { backgroundColor };
}

export default function GlassView({ glassEffectStyle = 'clear', tintColor, style, children, ...props }) {
    const { theme } = useTheme();
    const { settings } = useUser();
    const glass = settings?.glass !== false;
    const resolvedTintColor = resolveTintColor(theme, tintColor);

    if (glass) {
        return (
            <NativeGlassView glassEffectStyle={glassEffectStyle} tintColor={resolvedTintColor} style={style} {...props}>
                {children}
            </NativeGlassView>
        );
    }

    return (
        <View style={[getBaseStyle(theme, tintColor, glassEffectStyle), style]} {...props}>
            {children}
        </View>
    );
}
