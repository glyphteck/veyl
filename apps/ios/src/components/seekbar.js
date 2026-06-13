import { useCallback, useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

function clampProgress(value) {
    'worklet';
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

export default function SeekBar({ progress = 0, disabled = false, onSeek, blockExternalGestures, trackColor, fillColor, height = 28, barHeight = 4, seekOnStart = true, align = 'center', style }) {
    const trackWidth = useSharedValue(0);
    const shown = useSharedValue(clampProgress(progress));
    const dragging = useSharedValue(false);

    useEffect(() => {
        if (disabled) {
            dragging.value = false;
            shown.value = clampProgress(progress);
            return;
        }
        if (!dragging.value) {
            shown.value = clampProgress(progress);
        }
    }, [disabled, dragging, progress, shown]);

    const commitSeek = useCallback((next) => {
        onSeek?.(next);
    }, [onSeek]);

    const fillStyle = useAnimatedStyle(() => ({
        width: trackWidth.value * clampProgress(shown.value),
    }));

    const pan = useMemo(() => {
        const seek = (x) => {
            'worklet';
            if (disabled || !trackWidth.value) {
                return;
            }
            shown.value = clampProgress(x / trackWidth.value);
        };

        let gesture = Gesture.Pan()
            .enabled(!disabled)
            .minDistance(0)
            .shouldCancelWhenOutside(false)
            .onBegin((event) => {
                dragging.value = true;
                if (seekOnStart) {
                    seek(event.x);
                }
            })
            .onUpdate((event) => {
                seek(event.x);
            })
            .onFinalize(() => {
                dragging.value = false;
                runOnJS(commitSeek)(clampProgress(shown.value));
            });
        const gestures = (Array.isArray(blockExternalGestures) ? blockExternalGestures : [blockExternalGestures]).filter(Boolean);
        if (gestures.length) {
            gesture = gesture.blocksExternalGesture(...gestures);
        }
        return gesture;
    }, [blockExternalGestures, commitSeek, disabled, dragging, seekOnStart, shown, trackWidth]);

    return (
        <GestureDetector gesture={pan}>
            <View
                style={[{ height, justifyContent: align, opacity: disabled ? 0.45 : 1 }, style]}
            >
                <View
                    onLayout={(event) => {
                        trackWidth.value = Math.round(event.nativeEvent.layout.width || 0);
                    }}
                    style={{ height: barHeight, borderRadius: 999, backgroundColor: trackColor, overflow: 'hidden' }}
                >
                    <Animated.View style={[{ height: '100%', backgroundColor: fillColor }, fillStyle]} />
                </View>
            </View>
        </GestureDetector>
    );
}
