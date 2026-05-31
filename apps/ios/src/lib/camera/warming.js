import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';

export const CAMERA_WARM_EVENT = 'veyl:camera-warm';
export const CAMERA_WARM_MS = 500;
export const CAMERA_PRELOAD_MS = 900;

function getWarmMs(ms) {
    const value = Number(ms);
    return Number.isFinite(value) && value > 0 ? value : CAMERA_WARM_MS;
}

export function warmCamera(ms = CAMERA_WARM_MS) {
    DeviceEventEmitter.emit(CAMERA_WARM_EVENT, { ms: getWarmMs(ms) });
}

export function useCameraWarming(pageOpen) {
    const [state, setState] = useState({
        mounted: pageOpen,
        warming: false,
        active: pageOpen,
    });
    const timerRef = useRef(null);
    const preloadTimerRef = useRef(null);
    const wasOpenRef = useRef(pageOpen);

    const clearTimer = useCallback(() => {
        if (!timerRef.current) return;
        clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const clearPreloadTimer = useCallback(() => {
        if (!preloadTimerRef.current) return;
        clearTimeout(preloadTimerRef.current);
        preloadTimerRef.current = null;
    }, []);

    const stop = useCallback(() => {
        clearTimer();
        setState((current) => (current.mounted && !current.warming && current.active ? current : { mounted: true, warming: false, active: true }));
    }, [clearTimer]);

    const start = useCallback(
        (ms = CAMERA_WARM_MS) => {
            const hold = getWarmMs(ms);

            clearTimer();
            setState((current) => (current.mounted && current.warming && current.active ? current : { mounted: true, warming: true, active: true }));
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                setState((current) => (current.warming || current.active ? { ...current, warming: false, active: false } : current));
            }, hold);
        },
        [clearTimer]
    );

    const startFromEvent = useCallback(
        (payload = {}) => {
            if (pageOpen) return;
            start(payload?.ms);
        },
        [pageOpen, start]
    );

    useEffect(() => {
        const sub = DeviceEventEmitter.addListener(CAMERA_WARM_EVENT, startFromEvent);
        return () => sub.remove();
    }, [startFromEvent]);

    useEffect(() => {
        const wasOpen = wasOpenRef.current;
        wasOpenRef.current = pageOpen;

        if (pageOpen) {
            clearPreloadTimer();
            stop();
        } else if (wasOpen) {
            start(CAMERA_WARM_MS);
        }
    }, [clearPreloadTimer, pageOpen, start, stop]);

    useEffect(() => {
        clearPreloadTimer();
        if (pageOpen || state.mounted) return undefined;

        preloadTimerRef.current = setTimeout(() => {
            preloadTimerRef.current = null;
            setState((current) => (current.mounted ? current : { ...current, mounted: true }));
        }, CAMERA_PRELOAD_MS);

        return clearPreloadTimer;
    }, [clearPreloadTimer, pageOpen, state.mounted]);

    useEffect(
        () => () => {
            clearTimer();
            clearPreloadTimer();
        },
        [clearPreloadTimer, clearTimer]
    );

    return {
        mounted: pageOpen || state.mounted,
        warming: state.warming,
        active: pageOpen || state.active,
    };
}
