import { useCallback, useEffect, useRef, useState } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { MESSAGE_ROW_ANIMATION_MS, MESSAGE_ROW_EASING, positivePx } from '@/components/chat/rowmotion';

export default function Dot({ show, failed, saved = false, side = 'right', bottomInset = 0, exitToken = 0, theme }) {
    const progress = useSharedValue(exitToken ? 1 : 0);
    const bottomOffset = useSharedValue(bottomInset);
    const [visualSaved, setVisualSaved] = useState(saved);
    const bottomOffsetTimerRef = useRef(null);

    const clearBottomOffsetTimer = useCallback(() => {
        if (bottomOffsetTimerRef.current) {
            clearTimeout(bottomOffsetTimerRef.current);
            bottomOffsetTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        progress.value = withTiming(show ? 1 : 0, { duration: MESSAGE_ROW_ANIMATION_MS, easing: MESSAGE_ROW_EASING });
    }, [progress, show]);

    useEffect(() => {
        clearBottomOffsetTimer();
        const nextInset = positivePx(bottomInset);
        const timing = { duration: MESSAGE_ROW_ANIMATION_MS, easing: MESSAGE_ROW_EASING };
        if (nextInset < bottomOffset.value) {
            bottomOffsetTimerRef.current = setTimeout(() => {
                bottomOffsetTimerRef.current = null;
                bottomOffset.value = withTiming(nextInset, timing);
            }, MESSAGE_ROW_ANIMATION_MS);
            return undefined;
        }

        bottomOffset.value = withTiming(nextInset, timing);
        return undefined;
    }, [bottomInset, bottomOffset, clearBottomOffsetTimer]);

    useEffect(() => {
        if (show || saved) {
            setVisualSaved(saved);
            return undefined;
        }

        const timeout = setTimeout(() => setVisualSaved(false), MESSAGE_ROW_ANIMATION_MS);
        return () => clearTimeout(timeout);
    }, [saved, show]);

    useEffect(() => clearBottomOffsetTimer, [clearBottomOffsetTimer]);

    const dotSpaceStyle = useAnimatedStyle(() => ({
        marginLeft: side === 'right' ? 8 * progress.value : 0,
        marginRight: side === 'left' ? 8 * progress.value : 0,
        marginBottom: bottomOffset.value,
        width: 8 * progress.value,
    }));
    const dotVisualStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 0.01 + 0.99 * progress.value }],
    }));

    const tintColor = failed ? theme.destructive : saved || visualSaved ? theme.foreground : theme.active;

    return (
        <Animated.View
            pointerEvents="none"
            style={[
                {
                    width: 0,
                    height: 8,
                    alignSelf: 'center',
                    overflow: 'visible',
                },
                dotSpaceStyle,
            ]}
        >
            <Animated.View
                style={[
                    {
                        position: 'absolute',
                        top: 0,
                        left: side === 'right' ? 0 : undefined,
                        right: side === 'left' ? 0 : undefined,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: tintColor,
                        overflow: 'hidden',
                    },
                    dotVisualStyle,
                ]}
            />
        </Animated.View>
    );
}
