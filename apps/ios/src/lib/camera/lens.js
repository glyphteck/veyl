import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { useCameraDevice } from 'react-native-vision-camera';
import { readLastCameraFacing, writeLastCameraFacing } from '@veyl/shared/cache/localdata';
import { mark } from '@/lib/diagnostics';

const BACK_REGULAR_LENS = { physicalDevices: ['wide-angle'] };
const BACK_WIDEST_LENS = { physicalDevices: ['ultra-wide-angle', 'wide-angle', 'telephoto'] };
const LENS_SWITCH_SETTLE_MS = 500;
const LENS_SWITCH_COOLDOWN = 1400;
const SIDE_SWITCH_COOLDOWN = 320;
const SIDE_SWITCH_BUSY_MS = 450;

export function useCameraLens({ active, localCache, mountedRef, pageOpen, stagedMedia, taking }) {
    const [facing, setFacing] = useState(() => readLastCameraFacing(localCache));
    const facingRef = useRef(facing);
    const [backLensMode, setBackLensMode] = useState('ultra-wide');
    const backRegularDevice = useCameraDevice('back', BACK_REGULAR_LENS);
    const backUltraWideDevice = useCameraDevice('back', BACK_WIDEST_LENS);
    const frontDevice = useCameraDevice('front');
    const backDevice = backLensMode === 'ultra-wide' ? backUltraWideDevice || backRegularDevice : backRegularDevice || backUltraWideDevice;
    const device = facing === 'back' ? backDevice : frontDevice;
    const lensSwitchRef = useRef(0);
    const lensSwitchTimerRef = useRef(null);
    const lensSwitchBusyRef = useRef(false);
    const sideSwitchRef = useRef(0);
    const sideSwitchBusyRef = useRef(false);
    const sideSwitchTimerRef = useRef(null);
    const activeRef = useRef(active);
    const pageOpenRef = useRef(pageOpen);
    const cameraReadyRef = useRef(false);
    const backLensModeRef = useRef(backLensMode);
    const backUltraWideDeviceRef = useRef(backUltraWideDevice);
    const [cameraReady, setCameraReady] = useState(false);

    const cancelLensSwitch = useCallback(() => {
        if (!lensSwitchTimerRef.current) return;
        clearTimeout(lensSwitchTimerRef.current);
        lensSwitchTimerRef.current = null;
    }, []);

    const clearSideSwitchBusy = useCallback((ready = false) => {
        if (sideSwitchTimerRef.current) {
            clearTimeout(sideSwitchTimerRef.current);
            sideSwitchTimerRef.current = null;
        }
        sideSwitchBusyRef.current = false;
        if (ready && mountedRef.current && activeRef.current) {
            cameraReadyRef.current = true;
            setCameraReady(true);
        }
    }, [mountedRef]);

    useEffect(() => {
        if (device?.position && device.position === facing) {
            clearSideSwitchBusy(false);
        }
    }, [clearSideSwitchBusy, device?.position, facing]);

    useEffect(() => {
        facingRef.current = facing;
    }, [facing]);

    useEffect(() => {
        activeRef.current = active;
    }, [active]);

    useEffect(() => {
        pageOpenRef.current = pageOpen;
    }, [pageOpen]);

    useEffect(() => {
        cameraReadyRef.current = cameraReady;
    }, [cameraReady]);

    useEffect(() => {
        cameraReadyRef.current = false;
        setCameraReady(false);
    }, [device?.id]);

    useEffect(() => {
        backLensModeRef.current = backLensMode;
    }, [backLensMode]);

    useEffect(() => {
        backUltraWideDeviceRef.current = backUltraWideDevice;
    }, [backUltraWideDevice]);

    useEffect(() => {
        const cachedFacing = readLastCameraFacing(localCache);
        facingRef.current = cachedFacing;
        setFacing((current) => (current === cachedFacing ? current : cachedFacing));
    }, [localCache]);

    useEffect(
        () => () => {
            if (lensSwitchTimerRef.current) clearTimeout(lensSwitchTimerRef.current);
            if (sideSwitchTimerRef.current) clearTimeout(sideSwitchTimerRef.current);
        },
        []
    );

    const holdSideSwitchBusy = useCallback(() => {
        if (sideSwitchTimerRef.current) clearTimeout(sideSwitchTimerRef.current);
        sideSwitchBusyRef.current = true;
        sideSwitchTimerRef.current = setTimeout(() => {
            sideSwitchTimerRef.current = null;
            sideSwitchBusyRef.current = false;
            if (mountedRef.current && activeRef.current) {
                cameraReadyRef.current = true;
                setCameraReady(true);
            }
        }, SIDE_SWITCH_BUSY_MS);
    }, [mountedRef]);

    const flipCamera = useCallback(({ recorderRef, recording, recordingRef, stopAfterStartRef } = {}) => {
        if (taking || stagedMedia) {
            mark('camera.flip.blocked', { taking, staged: stagedMedia?.kind || '' });
            return;
        }
        const recordingActive = recordingRef?.current || recording;
        if (recordingActive && (!recorderRef?.current || stopAfterStartRef?.current)) {
            mark('camera.flip.blocked', { recording: true, recorderReady: !!recorderRef?.current, stopping: !!stopAfterStartRef?.current });
            return;
        }
        if (!mountedRef.current || !pageOpenRef.current || !activeRef.current) return;
        if (sideSwitchBusyRef.current) {
            mark('camera.flip.blocked', { switching: true });
            return;
        }
        const now = Date.now();
        if (now - sideSwitchRef.current < SIDE_SWITCH_COOLDOWN) return;
        sideSwitchRef.current = now;
        const currentFacing = facingRef.current;
        const nextFacing = currentFacing === 'back' ? 'front' : 'back';
        mark('camera.flip', { from: currentFacing, to: nextFacing, deviceId: device?.id || '', recording: recordingActive });
        cancelLensSwitch();
        lensSwitchBusyRef.current = false;
        holdSideSwitchBusy();
        cameraReadyRef.current = false;
        setCameraReady(false);
        if (backLensModeRef.current !== 'ultra-wide') {
            backLensModeRef.current = 'ultra-wide';
            setBackLensMode('ultra-wide');
        }
        facingRef.current = nextFacing;
        setFacing(nextFacing);
        writeLastCameraFacing(localCache, nextFacing);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }, [cancelLensSwitch, device?.id, holdSideSwitchBusy, localCache, mountedRef, stagedMedia, taking]);

    const switchBackLens = useCallback(
        (mode, { recording, recordingRef } = {}) => {
            if (mode !== 'regular' && mode !== 'ultra-wide') return;
            cancelLensSwitch();

            lensSwitchTimerRef.current = setTimeout(() => {
                lensSwitchTimerRef.current = null;
                if (!mountedRef.current || !pageOpenRef.current || !activeRef.current) return;
                if (facingRef.current !== 'back' || taking || stagedMedia || recordingRef?.current || recording) return;
                const currentMode = backLensModeRef.current;
                if (mode === currentMode) return;
                if (mode === 'ultra-wide' && !backUltraWideDeviceRef.current) return;
                if (!cameraReadyRef.current || lensSwitchBusyRef.current) return;

                const now = Date.now();
                if (now - lensSwitchRef.current < LENS_SWITCH_COOLDOWN) return;
                lensSwitchRef.current = now;
                lensSwitchBusyRef.current = true;
                cameraReadyRef.current = false;
                setCameraReady(false);
                mark('camera.lens', { from: currentMode, to: mode, deviceId: device?.id || '' });
                backLensModeRef.current = mode;
                setBackLensMode(mode);
            }, LENS_SWITCH_SETTLE_MS);
        },
        [cancelLensSwitch, device?.id, mountedRef, stagedMedia, taking]
    );

    const resetUnavailable = useCallback((recording) => {
        if (pageOpen && facing === 'back' && !taking && !stagedMedia && !recording) return;
        cancelLensSwitch();
        lensSwitchBusyRef.current = false;
        if (!pageOpen || stagedMedia) clearSideSwitchBusy(false);
    }, [cancelLensSwitch, clearSideSwitchBusy, facing, pageOpen, stagedMedia, taking]);

    const canFocus = useCallback(({ recordingRef } = {}) => {
        return pageOpenRef.current && activeRef.current && cameraReadyRef.current && !sideSwitchBusyRef.current && !lensSwitchBusyRef.current && !recordingRef?.current;
    }, []);

    const handleCameraStarted = useCallback(() => {
        lensSwitchBusyRef.current = false;
        clearSideSwitchBusy(true);
        cameraReadyRef.current = true;
        mark('camera.started', { deviceId: device?.id || '', facing });
        setCameraReady(true);
    }, [clearSideSwitchBusy, device?.id, facing]);

    const handleCameraError = useCallback((error) => {
        lensSwitchBusyRef.current = false;
        clearSideSwitchBusy(false);
        cameraReadyRef.current = false;
        setCameraReady(false);
        mark('camera.error', { deviceId: device?.id || '', facing, message: error?.message || String(error), code: error?.code || '' });
        console.warn('camera failed', error);
    }, [clearSideSwitchBusy, device?.id, facing]);

    return {
        backLensMode,
        backRegularDevice,
        backUltraWideDevice,
        cameraReady,
        canFocus,
        canUseUltraWide: facing === 'back' && backLensMode !== 'ultra-wide' && !!backUltraWideDevice && device?.id !== backUltraWideDevice.id,
        cancelLensSwitch,
        device,
        facing,
        flipCamera,
        frontDevice,
        handleCameraError,
        handleCameraStarted,
        isUltraWide: facing === 'back' && backLensMode === 'ultra-wide' && !!backUltraWideDevice && device?.id === backUltraWideDevice.id,
        resetUnavailable,
        switchBackLens,
    };
}
