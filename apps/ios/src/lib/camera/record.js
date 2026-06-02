import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { mark } from '@/lib/diagnostics';
import { stageCapturedVideo } from '@/lib/camera/staging';

export const RECORD_PRESS_SCALE = 0.9;
export const RECORDING_SCALE = 0.76;
const LOCK_CLAIM_DISTANCE = 10;
const LOCK_SLIDE_DISTANCE = 58;
const LOCK_AXIS_RATIO = 1.2;
const LOCK_VERTICAL_FAIL = 44;

function getGestureTouch(event) {
    'worklet';
    const touch = event?.allTouches?.[0] || event?.changedTouches?.[0];
    return {
        x: touch?.x ?? 0,
        y: touch?.y ?? 0,
    };
}

export function getNativeTouch(event) {
    const touch = event?.nativeEvent?.changedTouches?.[0] || event?.nativeEvent?.touches?.[0] || event?.nativeEvent;
    return {
        valid: !!touch,
        x: Number(touch?.pageX ?? touch?.locationX ?? 0),
        y: Number(touch?.pageY ?? touch?.locationY ?? 0),
    };
}

export function isRecordLockSlide(event, start) {
    const point = getNativeTouch(event);
    if (!point.valid) return false;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    return ax >= LOCK_SLIDE_DISTANCE && ax > ay * LOCK_AXIS_RATIO;
}

export function useRecord({ animateShutter, deviceId, facing, hidePreview, mountedRef, onStaged, orientationRef, previewVisible, stagedMedia, taking, videoOutput }) {
    const recorderRef = useRef(null);
    const recordingRef = useRef(false);
    const recordingLockedRef = useRef(false);
    const lockPendingRef = useRef(false);
    const lockReleasePendingRef = useRef(false);
    const shutterHeldRef = useRef(false);
    const shutterStartRef = useRef({ x: 0, y: 0 });
    const recordingOrientationRef = useRef('up');
    const recordingTokenRef = useRef(0);
    const stopAfterStartRef = useRef(false);
    const lockGestureEnabled = useSharedValue(false);
    const lockGestureActive = useSharedValue(false);
    const lockStartX = useSharedValue(0);
    const lockStartY = useSharedValue(0);
    const [recording, setRecording] = useState(false);
    const [recordingLocked, setRecordingLocked] = useState(false);

    const setHeld = useCallback((nextHeld) => {
        shutterHeldRef.current = nextHeld;
    }, []);

    const clear = useCallback(
        (token = recordingTokenRef.current) => {
            if (token !== recordingTokenRef.current) return;
            recorderRef.current = null;
            recordingRef.current = false;
            recordingLockedRef.current = false;
            lockPendingRef.current = false;
            lockReleasePendingRef.current = false;
            setHeld(false);
            lockGestureEnabled.value = false;
            stopAfterStartRef.current = false;
            setRecording(false);
            setRecordingLocked(false);
            animateShutter(1);
        },
        [animateShutter, lockGestureEnabled, setHeld]
    );

    const stop = useCallback(() => {
        mark('camera.video.stop', { recording: !!recordingRef.current, hasRecorder: !!recorderRef.current, locked: !!recordingLockedRef.current });
        setHeld(false);
        recordingLockedRef.current = false;
        lockPendingRef.current = false;
        lockReleasePendingRef.current = false;
        lockGestureEnabled.value = false;
        setRecordingLocked(false);
        if (!recordingRef.current && !recorderRef.current) {
            stopAfterStartRef.current = false;
            animateShutter(1);
            return;
        }
        stopAfterStartRef.current = true;
        setRecording(false);
        animateShutter(1);
        const recorder = recorderRef.current;
        if (!recorder?.stopRecording) return;
        recorder.stopRecording().catch((error) => {
            mark('camera.video.stop.error', { message: error?.message || String(error) });
            console.warn('stop video recording failed', error);
            clear();
        });
    }, [animateShutter, clear, lockGestureEnabled, setHeld]);

    const lock = useCallback(
        (ignoreNextRelease = true) => {
            if (!recordingRef.current || recordingLockedRef.current) {
                lockPendingRef.current = false;
                return;
            }
            recordingLockedRef.current = true;
            lockPendingRef.current = false;
            lockReleasePendingRef.current = ignoreNextRelease;
            setHeld(false);
            lockGestureEnabled.value = false;
            setRecordingLocked(true);
            animateShutter(RECORD_PRESS_SCALE);
            Haptics.selectionAsync().catch(() => {});
        },
        [animateShutter, lockGestureEnabled, setHeld]
    );

    const beginLock = useCallback(
        (ignoreNextRelease = true) => {
            lockPendingRef.current = true;
            setHeld(false);
            lock(ignoreNextRelease);
        },
        [lock, setHeld]
    );

    const start = useCallback(async () => {
        if (taking || recordingRef.current || stagedMedia) return;
        if (previewVisible) {
            hidePreview();
            return;
        }
        if (!shutterHeldRef.current) return;

        const token = recordingTokenRef.current + 1;
        recordingTokenRef.current = token;
        recordingRef.current = true;
        recordingOrientationRef.current = orientationRef.current;
        videoOutput.outputOrientation = recordingOrientationRef.current;
        stopAfterStartRef.current = false;
        setRecording(true);
        lockGestureEnabled.value = true;
        animateShutter(RECORDING_SCALE);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

        try {
            mark('camera.video.start', { deviceId, facing, orientation: recordingOrientationRef.current });
            const recorder = await videoOutput.createRecorder({});
            if (!mountedRef.current || token !== recordingTokenRef.current) {
                recorder.stopRecording?.().catch?.(() => {});
                return;
            }

            recorderRef.current = recorder;
            if (!shutterHeldRef.current) {
                stopAfterStartRef.current = true;
            }
            await recorder.startRecording(
                (path) => {
                    if (token !== recordingTokenRef.current) return;
                    clear(token);
                    try {
                        const video = stageCapturedVideo(path, recordingOrientationRef.current);
                        mark('camera.video.done', { uri: video.uri, orientation: recordingOrientationRef.current });
                        onStaged(video);
                    } catch (error) {
                        mark('camera.video.stage.error', { message: error?.message || String(error) });
                        console.warn('stage video failed', error);
                        if (mountedRef.current) Alert.alert('Capture failed', 'Could not record the video.');
                    }
                },
                (error) => {
                    if (token !== recordingTokenRef.current) return;
                    clear(token);
                    mark('camera.video.record.error', { message: error?.message || String(error) });
                    console.warn('record video failed', error);
                    if (mountedRef.current) Alert.alert('Capture failed', 'Could not record the video.');
                }
            );

            if (stopAfterStartRef.current || (!shutterHeldRef.current && !recordingLockedRef.current)) {
                stop();
            }
        } catch (error) {
            if (token !== recordingTokenRef.current) return;
            clear(token);
            mark('camera.video.start.error', { message: error?.message || String(error) });
            console.warn('start video recording failed', error);
            if (mountedRef.current) Alert.alert('Capture failed', 'Could not record the video.');
        }
    }, [animateShutter, clear, deviceId, facing, hidePreview, lockGestureEnabled, mountedRef, onStaged, orientationRef, previewVisible, stagedMedia, stop, taking, videoOutput]);

    const lockGesture = useMemo(
        () =>
            Gesture.Pan()
                .manualActivation(true)
                .shouldCancelWhenOutside(false)
                .onTouchesDown((event) => {
                    'worklet';
                    const point = getGestureTouch(event);
                    lockStartX.value = point.x;
                    lockStartY.value = point.y;
                    lockGestureActive.value = false;
                })
                .onTouchesMove((event, state) => {
                    'worklet';
                    if (lockGestureActive.value) return;

                    const point = getGestureTouch(event);
                    const dx = point.x - lockStartX.value;
                    const dy = point.y - lockStartY.value;
                    const ax = Math.abs(dx);
                    const ay = Math.abs(dy);

                    if (!lockGestureEnabled.value) return;

                    if (ay > LOCK_VERTICAL_FAIL && ay > ax * LOCK_AXIS_RATIO) {
                        state.fail();
                        return;
                    }

                    if (ax >= LOCK_SLIDE_DISTANCE && ax > ay * LOCK_AXIS_RATIO) {
                        lockGestureActive.value = true;
                        lockGestureEnabled.value = false;
                        scheduleOnRN(beginLock);
                        state.activate();
                        return;
                    }

                    if (ax >= LOCK_CLAIM_DISTANCE && ax > ay * LOCK_AXIS_RATIO) {
                        lockGestureActive.value = true;
                        state.activate();
                    }
                })
                .onUpdate((event) => {
                    'worklet';
                    if (!lockGestureEnabled.value) return;

                    const ax = Math.abs(event.translationX);
                    const ay = Math.abs(event.translationY);
                    if (ax >= LOCK_SLIDE_DISTANCE && ax > ay * LOCK_AXIS_RATIO) {
                        lockGestureEnabled.value = false;
                        scheduleOnRN(beginLock);
                    }
                })
                .onFinalize(() => {
                    'worklet';
                    const shouldStopRecording = lockGestureActive.value && lockGestureEnabled.value;
                    lockGestureActive.value = false;
                    if (shouldStopRecording) {
                        scheduleOnRN(stop);
                    }
                }),
        [beginLock, lockGestureActive, lockGestureEnabled, lockStartX, lockStartY, stop]
    );

    useEffect(
        () => () => {
            recorderRef.current?.stopRecording?.().catch?.(() => {});
        },
        []
    );

    return {
        beginLock,
        lockGesture,
        lockGestureActive,
        lockGestureEnabled,
        lockPendingRef,
        lockReleasePendingRef,
        recorderRef,
        recording,
        recordingLocked,
        recordingLockedRef,
        recordingOrientationRef,
        recordingRef,
        setHeld,
        shutterHeldRef,
        shutterStartRef,
        start,
        stop,
        stopAfterStartRef,
    };
}
