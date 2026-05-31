import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export default function SeekBar({ progress = 0, disabled = false, onSeek, blockExternalGestures, trackColor, fillColor, height = 28, barHeight = 4, seekOnStart = true, align = 'center', style }) {
    const widthRef = useRef(0);
    const [drag, setDrag] = useState(null);
    const shown = drag == null ? progress : drag;

    useEffect(() => {
        if (disabled) {
            setDrag(null);
        }
    }, [disabled]);

    const seek = useCallback(
        (x) => {
            const width = widthRef.current;
            if (disabled || !width) {
                return;
            }
            const next = Math.max(0, Math.min(1, x / width));
            setDrag(next);
            onSeek?.(next);
        },
        [disabled, onSeek]
    );

    const endDrag = useCallback(() => {
        setDrag(null);
    }, []);

    const pan = useMemo(() => {
        let gesture = Gesture.Pan()
            .enabled(!disabled)
            .minDistance(0)
            .shouldCancelWhenOutside(false)
            .runOnJS(true)
            .onBegin((event) => {
                if (seekOnStart) {
                    seek(event.x);
                }
            })
            .onUpdate((event) => {
                seek(event.x);
            })
            .onFinalize(endDrag);
        const gestures = (Array.isArray(blockExternalGestures) ? blockExternalGestures : [blockExternalGestures]).filter(Boolean);
        if (gestures.length) {
            gesture = gesture.blocksExternalGesture(...gestures);
        }
        return gesture;
    }, [blockExternalGestures, disabled, endDrag, seek, seekOnStart]);

    return (
        <GestureDetector gesture={pan}>
            <View
                onLayout={(event) => {
                    widthRef.current = Math.round(event.nativeEvent.layout.width || 0);
                }}
                style={[{ height, justifyContent: align, opacity: disabled ? 0.45 : 1 }, style]}
            >
                <View style={{ height: barHeight, borderRadius: 999, backgroundColor: trackColor, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.max(0, Math.min(1, shown)) * 100}%`, height: '100%', backgroundColor: fillColor }} />
                </View>
            </View>
        </GestureDetector>
    );
}
