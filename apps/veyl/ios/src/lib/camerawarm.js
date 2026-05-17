import { DeviceEventEmitter } from 'react-native';

export const CAMERA_WARM_EVENT = 'veyl:camera-warm';
export const CAMERA_WARM_MS = 900;

export function warmCamera(ms = CAMERA_WARM_MS) {
    const duration = Number(ms);
    DeviceEventEmitter.emit(CAMERA_WARM_EVENT, {
        ms: Number.isFinite(duration) && duration > 0 ? duration : CAMERA_WARM_MS,
    });
}
