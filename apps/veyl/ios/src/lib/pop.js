import { useEffect, useMemo, useRef } from 'react';
import { Animated } from 'react-native';

export function usePop({
    show,
    width,
    height,
    gapBefore = 0,
    gapAfter = 0,
    from = 0.001,
    enterSpeed = 18,
    enterBounce = 10,
    exitDuration = 160,
} = {}) {
    const value = useRef(new Animated.Value(show ? 1 : 0)).current;

    const scale = useMemo(
        () =>
            value.interpolate({
                inputRange: [0, 1],
                outputRange: [from, 1],
            }),
        [from, value]
    );

    const style = useMemo(() => {
        const next = {};

        if (width != null) {
            next.width = value.interpolate({
                inputRange: [0, 1],
                outputRange: [0, width],
            });
        }
        if (height != null) {
            next.height = value.interpolate({
                inputRange: [0, 1],
                outputRange: [0, height],
            });
        }
        if (gapBefore) {
            next.marginLeft = value.interpolate({
                inputRange: [0, 1],
                outputRange: [0, gapBefore],
            });
        }
        if (gapAfter) {
            next.marginRight = value.interpolate({
                inputRange: [0, 1],
                outputRange: [0, gapAfter],
            });
        }

        return next;
    }, [gapAfter, gapBefore, height, value, width]);

    useEffect(() => {
        value.stopAnimation();

        if (show) {
            Animated.spring(value, {
                toValue: 1,
                useNativeDriver: false,
                speed: enterSpeed,
                bounciness: enterBounce,
            }).start();
            return;
        }

        Animated.timing(value, {
            toValue: 0,
            duration: exitDuration,
            useNativeDriver: false,
        }).start();
    }, [enterBounce, enterSpeed, exitDuration, show, value]);

    return {
        value,
        scale,
        style,
        childStyle: { transform: [{ scale }] },
        pointerEvents: show ? 'auto' : 'none',
    };
}
