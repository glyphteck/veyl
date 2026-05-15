import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { ActivityIndicator, Pressable, TextInput } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Search, X } from 'lucide-react-native';

import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { useTheme } from '@/providers/themeprovider';

const SearchInput = forwardRef(function SearchInput(
    {
        value,
        onChangeText,
        onClear,
        searching = false,
        placeholder = 'search',
        glassEffectStyle = 'regular',
        tintColor,
        style,
        inputStyle,
        onFocus,
        onBlur,
        ...props
    },
    ref
) {
    const { theme, isDark } = useTheme();
    const inputRef = useRef(null);
    const focus = useSharedValue(0);
    const mutedIconStyle = useAnimatedStyle(() => ({ opacity: 1 - focus.value }));
    const foregroundIconStyle = useAnimatedStyle(() => ({ opacity: focus.value }));

    useImperativeHandle(ref, () => inputRef.current, []);

    const handleFocus = useCallback(
        (event) => {
            focus.value = withTiming(1, { duration: 160 });
            onFocus?.(event);
        },
        [focus, onFocus]
    );

    const handleBlur = useCallback(
        (event) => {
            focus.value = withTiming(0, { duration: 160 });
            onBlur?.(event);
        },
        [focus, onBlur]
    );

    return (
        <GlassView
            glassEffectStyle={glassEffectStyle}
            tintColor={tintColor}
            style={[
                {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingRight: 14,
                    paddingLeft: 12,
                    paddingVertical: 8,
                    borderRadius: 24,
                },
                style,
            ]}
        >
            <Pressable accessibilityRole="button" accessibilityLabel="focus search" onPress={() => inputRef.current?.focus?.()} hitSlop={10}>
                <Animated.View style={{ paddingVertical: 1 }}>
                    <Animated.View style={mutedIconStyle}>
                        <Icon icon={Search} color={theme.muted} />
                    </Animated.View>
                    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 1, left: 0 }, foregroundIconStyle]}>
                        <Icon icon={Search} color={theme.foreground} />
                    </Animated.View>
                </Animated.View>
            </Pressable>
            <TextInput
                ref={inputRef}
                value={value}
                placeholder={placeholder}
                placeholderTextColor={theme.muted}
                style={[{ flex: 1, color: theme.foreground, fontSize: 18, paddingVertical: 4 }, inputStyle]}
                onChangeText={onChangeText}
                onFocus={handleFocus}
                onBlur={handleBlur}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                autoCapitalize="none"
                autoCorrect={false}
                {...props}
            />
            {searching ? (
                <ActivityIndicator size="small" color={theme.muted} />
            ) : value ? (
                <Pressable onPress={onClear} hitSlop={10}>
                    <Icon icon={X} color={theme.muted} />
                </Pressable>
            ) : null}
        </GlassView>
    );
});

export default SearchInput;
