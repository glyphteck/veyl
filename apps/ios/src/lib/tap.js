import { useCallback, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { withSpring } from 'react-native-reanimated';

const TAP_SCALE = 0.9;
const DRIFT = 0;

const SPRING = {
    useNativeDriver: true,
    speed: 30,
    bounciness: 15,
};

const RE_SPRING = {
    mass: 0.5,
    stiffness: 350,
    damping: 18,
};

function hitOnce(kind) {
    let promise = null;

    switch (kind) {
        case 'selection':
            promise = Haptics.selectionAsync();
            break;
        case 'light':
            promise = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            break;
        case 'medium':
            promise = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            break;
        case 'soft':
            promise = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
            break;
        case 'success':
            promise = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            break;
        default:
            break;
    }

    promise?.catch?.(() => {});
}

function hit(kind) {
    if (!kind) return;

    if (Array.isArray(kind)) {
        kind.forEach((step) => hit(step));
        return;
    }

    if (typeof kind === 'function') {
        const promise = kind();
        promise?.catch?.(() => {});
        return;
    }

    if (typeof kind === 'object') {
        const { kind: nextKind, delay = 0 } = kind;
        if (!nextKind) return;
        if (delay > 0) {
            setTimeout(() => hit(nextKind), delay);
            return;
        }
        hit(nextKind);
        return;
    }

    hitOnce(kind);
}

function startTouch(touch, e) {
    if (!touch) return;
    const { pageX, pageY } = e?.nativeEvent ?? {};
    if (typeof pageX !== 'number' || typeof pageY !== 'number') {
        touch.start = null;
        touch.moved = false;
        return;
    }
    touch.start = { x: pageX, y: pageY };
    touch.moved = false;
}

function moveTouch(touch, drift, e) {
    if (!touch?.start || touch.moved || !drift) return false;
    const { pageX, pageY } = e?.nativeEvent ?? {};
    if (typeof pageX !== 'number' || typeof pageY !== 'number') return false;
    const dx = pageX - touch.start.x;
    const dy = pageY - touch.start.y;
    if (dx * dx + dy * dy < drift * drift) return false;
    touch.moved = true;
    touch.start = null;
    return true;
}

function resetTouch(touch) {
    if (!touch) return;
    touch.start = null;
    touch.moved = false;
    touch.long = false;
    touch.locked = false;
}

function releaseTouch(touch) {
    if (!touch) return;
    touch.start = null;
    touch.moved = false;
    touch.long = false;
    touch.locked = false;
}

function finishLongPress(touch, animateTo, active, activeScale) {
    if (!touch) return;
    touch.locked = false;
    touch.long = false;
    touch.start = null;
    animateTo?.(active ? activeScale : 1);
}

function makeTap({
    disabled = false,
    active = false,
    onPress,
    onLongPress,
    animateTo,
    scale = TAP_SCALE,
    longScale = scale,
    activeScale = longScale,
    hapticIn = false,
    hapticOut = 'soft',
    hapticPress = false,
    hapticLongPress = 'medium',
    drift = DRIFT,
    delayLongPress = 220,
    holdAfterLongPress = false,
    releaseLongPressOnPressOut = false,
    touch = null,
}) {
    return {
        onPress: () => {
            if (disabled || touch?.moved || touch?.long) {
                releaseTouch(touch);
                return;
            }
            hit(hapticOut);
            hit(hapticPress);
            onPress?.();
            releaseTouch(touch);
        },
        onPressIn: (e) => {
            if (disabled) return;
            startTouch(touch, e);
            touch.long = false;
            hit(hapticIn === true ? 'light' : hapticIn);
            animateTo?.(scale);
        },
        onPressOut: () => {
            if (disabled) return;
            if (touch?.moved || active) {
                touch.start = null;
                return;
            }
            if (touch?.long && releaseLongPressOnPressOut) {
                animateTo?.(1);
                touch.locked = false;
                touch.start = null;
                return;
            }
            if (touch?.locked || touch?.long) {
                touch.start = null;
                return;
            }
            animateTo?.(1);
            touch.start = null;
        },
        ...(typeof onLongPress === 'function'
            ? {
                  onLongPress: (e) => {
                      if (disabled || touch?.moved) return;
                      touch.long = true;
                      touch.locked = holdAfterLongPress || releaseLongPressOnPressOut;
                      hit(hapticLongPress);
                      animateTo?.(longScale);
                      if (releaseLongPressOnPressOut) {
                          onLongPress?.(e);
                          return;
                      }
                      const result = onLongPress?.(e);
                      if (holdAfterLongPress) {
                          return;
                      }
                      Promise.resolve(result)
                          .catch(() => {})
                          .finally(() => {
                              finishLongPress(touch, animateTo, active, activeScale);
                          });
                  },
                  delayLongPress,
              }
            : {}),
        onTouchStart: (e) => {
            if (disabled) return;
            startTouch(touch, e);
        },
        onTouchMove: (e) => {
            if (disabled || !moveTouch(touch, drift, e)) return;
            animateTo?.(active ? activeScale : 1);
        },
        onTouchCancel: () => {
            if (disabled) return;
            if (touch?.long && releaseLongPressOnPressOut) {
                animateTo?.(active ? activeScale : 1);
                releaseTouch(touch);
                return;
            }
            if (touch?.locked || active) {
                touch.start = null;
                return;
            }
            animateTo?.(1);
            releaseTouch(touch);
        },
    };
}

export function useTap({
    disabled = false,
    active = false,
    onPress,
    onLongPress,
    scale = TAP_SCALE,
    longScale = scale,
    activeScale = longScale,
    hapticIn = false,
    hapticOut = 'soft',
    hapticPress = false,
    hapticLongPress = 'medium',
    drift = DRIFT,
    delayLongPress = 220,
    holdAfterLongPress = false,
    releaseLongPressOnPressOut = false,
    spring = SPRING,
} = {}) {
    const value = useRef(new Animated.Value(1)).current;
    const touch = useRef({ start: null, moved: false, long: false, locked: false }).current;

    const animateTo = useCallback(
        (toValue) => {
            Animated.spring(value, {
                ...spring,
                toValue,
            }).start();
        },
        [spring, value]
    );

    useEffect(() => {
        if (disabled) {
            animateTo(1);
            releaseTouch(touch);
            return;
        }
        if (active) {
            animateTo(activeScale);
            return;
        }
        if (touch.locked && holdAfterLongPress) {
            finishLongPress(touch, animateTo, false, activeScale);
            return;
        }
        if (!touch.locked) {
            animateTo(1);
        }
    }, [active, activeScale, animateTo, disabled, holdAfterLongPress, touch]);

    const props = makeTap({
        disabled,
        active,
        onPress,
        onLongPress,
        animateTo,
        scale,
        longScale,
        activeScale,
        hapticIn,
        hapticOut,
        hapticPress,
        hapticLongPress,
        drift,
        delayLongPress,
        holdAfterLongPress,
        releaseLongPressOnPressOut,
        touch,
    });

    return {
        scale: value,
        release: () => {
            finishLongPress(touch, animateTo, false, activeScale);
        },
        ...props,
        props,
    };
}

export function tap({ value, disabled = false, onPress, scale = TAP_SCALE, hapticIn = false, hapticOut = 'soft', hapticPress = false, drift = DRIFT, spring = RE_SPRING } = {}) {
    const touch = { start: null, moved: false, long: false, locked: false };
    return makeTap({
        disabled,
        onPress,
        scale,
        hapticIn,
        hapticOut,
        hapticPress,
        drift,
        touch,
        animateTo: (toValue) => {
            value.value = withSpring(toValue, spring);
        },
    });
}
