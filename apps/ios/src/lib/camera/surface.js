import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Camera as VCamera } from 'react-native-vision-camera';

const NORMAL_ZOOM = 1;
const MAX_CAMERA_ZOOM = 6;
const PINCH_ULTRA_WIDE_SCALE = 0.72;
const PINCH_REGULAR_SCALE = 1.35;
const FOCUS_HOLD = 350;
const FOCUS_DRIFT = 18;
const DOUBLE_TAP_MAX_DELAY = 260;
const DOUBLE_TAP_MAX_DISTANCE = 24;
const DOUBLE_TAP_MAX_DURATION = 180;

function clampZoom(value, min, max) {
    'worklet';
    return Math.min(max, Math.max(min, value));
}

function getInitialZoom(device) {
    const min = Number.isFinite(device?.minZoom) ? device.minZoom : NORMAL_ZOOM;
    const max = Number.isFinite(device?.maxZoom) ? device.maxZoom : NORMAL_ZOOM;
    return clampZoom(min, min, max);
}

export function CameraSurface({
    active,
    cameraRef,
    canUseUltraWide,
    device,
    facing,
    isUltraWide,
    onCameraError,
    onCameraStarted,
    onCancelLensSwitch,
    onFlip,
    onFocus,
    onUseRegularLens,
    onUseUltraWide,
    orientationLocked,
    outputs,
}) {
    const minZoom = Number.isFinite(device?.minZoom) ? device.minZoom : NORMAL_ZOOM;
    const deviceMaxZoom = Number.isFinite(device?.maxZoom) ? device.maxZoom : NORMAL_ZOOM;
    const maxZoom = Math.max(minZoom, Math.min(deviceMaxZoom, MAX_CAMERA_ZOOM));
    const initialZoom = getInitialZoom(device);
    const cameraZoom = useSharedValue(initialZoom);
    const pinchStartZoom = useSharedValue(initialZoom);
    const pinchLastScale = useSharedValue(1);

    useEffect(() => {
        cameraZoom.value = initialZoom;
        pinchStartZoom.value = initialZoom;
    }, [cameraZoom, device?.id, initialZoom, pinchStartZoom]);

    const doubleTapGesture = Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(DOUBLE_TAP_MAX_DELAY)
        .maxDistance(DOUBLE_TAP_MAX_DISTANCE)
        .maxDuration(DOUBLE_TAP_MAX_DURATION)
        .onEnd(() => {
            'worklet';
            scheduleOnRN(onFlip);
        });

    const pinchGesture = useMemo(
        () =>
            Gesture.Pinch()
                .onBegin(() => {
                    'worklet';
                    scheduleOnRN(onCancelLensSwitch);
                    pinchStartZoom.value = cameraZoom.value;
                    pinchLastScale.value = 1;
                })
                .onUpdate((event) => {
                    'worklet';
                    pinchLastScale.value = event.scale;
                    const nextZoom = clampZoom(pinchStartZoom.value * event.scale, minZoom, maxZoom);
                    cameraZoom.value = nextZoom;
                })
                .onEnd(() => {
                    'worklet';
                    if (canUseUltraWide && !isUltraWide && pinchLastScale.value <= PINCH_ULTRA_WIDE_SCALE) {
                        scheduleOnRN(onUseUltraWide);
                    } else if (isUltraWide && pinchLastScale.value >= PINCH_REGULAR_SCALE) {
                        scheduleOnRN(onUseRegularLens);
                    }
                }),
        [cameraZoom, canUseUltraWide, isUltraWide, maxZoom, minZoom, onCancelLensSwitch, onUseRegularLens, onUseUltraWide, pinchLastScale, pinchStartZoom]
    );

    const focusGesture = Gesture.LongPress()
        .minDuration(FOCUS_HOLD)
        .maxDistance(FOCUS_DRIFT)
        .numberOfPointers(1)
        .onStart((e) => {
            'worklet';
            scheduleOnRN(onFocus, e.x, e.y);
        });

    const touchGesture = Gesture.Race(pinchGesture, Gesture.Exclusive(doubleTapGesture, focusGesture));

    return (
        <GestureDetector gesture={touchGesture}>
            <View pointerEvents={active ? 'auto' : 'none'} style={StyleSheet.absoluteFill}>
                <VCamera
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={active}
                    outputs={outputs}
                    orientationSource={orientationLocked ? 'custom' : 'device'}
                    mirrorMode={facing === 'front' ? 'on' : 'off'}
                    onError={onCameraError}
                    onStarted={onCameraStarted}
                    resizeMode="cover"
                    zoom={cameraZoom}
                />
            </View>
        </GestureDetector>
    );
}
