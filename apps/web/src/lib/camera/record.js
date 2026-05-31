import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { stageVideoCapture } from '@/lib/camera/staging';

const VIDEO_HOLD_MS = 220;
const VIDEO_FRAME_RATE = 30;
const LOCK_SLIDE_DISTANCE = 58;
const LOCK_AXIS_RATIO = 1.2;
const LOCK_VERTICAL_FAIL = 44;

function shutterKeyValue(event) {
    if (event.key === 'Enter') return 'Enter';
    if (event.key === ' ' || event.code === 'Space') return ' ';
    return '';
}

function isLockKey(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const key = String(event.key || '').toLowerCase();
    return key === 'l' || event.key === 'ArrowLeft' || event.key === 'ArrowRight';
}

function isHorizontalLockSlide(event, start) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const dx = x - Number(start?.startX || 0);
    const dy = y - Number(start?.startY || 0);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ay > LOCK_VERTICAL_FAIL && ay > ax * LOCK_AXIS_RATIO) return false;

    const rect = event.currentTarget?.getBoundingClientRect?.();
    const leftRightExit = rect && (x < rect.left || x > rect.right) && ax > ay * LOCK_AXIS_RATIO;
    return leftRightExit || (ax >= LOCK_SLIDE_DISTANCE && ax > ay * LOCK_AXIS_RATIO);
}

function getVideoMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const types = ['video/mp4;codecs=h264,aac', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return types.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
}

function makeRecordingStream(video) {
    const source = video?.srcObject;
    if (!source || typeof source.getVideoTracks !== 'function') {
        throw new Error('camera stream unavailable');
    }

    if (!video || typeof document === 'undefined') {
        return { stream: source, stop: () => {} };
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') {
        return { stream: source, stop: () => {} };
    }

    let frame = null;
    let active = true;
    const draw = () => {
        if (!active) return;
        const width = video.videoWidth || video.clientWidth || 1280;
        const height = video.videoHeight || video.clientHeight || 720;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        ctx.save();
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, width, height);
        ctx.restore();
        frame = requestAnimationFrame(draw);
    };

    draw();
    const stream = canvas.captureStream(VIDEO_FRAME_RATE);
    return {
        stream,
        stop: () => {
            active = false;
            if (frame) cancelAnimationFrame(frame);
            stream.getTracks().forEach((track) => track.stop());
        },
    };
}

export function useRecord({ captureRef, onPhoto, setCapture, webcamRef }) {
    const recorderRef = useRef(null);
    const recordChunksRef = useRef([]);
    const recordSessionRef = useRef(null);
    const pointerRef = useRef({ id: null, timer: null, long: false, startX: 0, startY: 0 });
    const keyRef = useRef({ active: false, key: '', timer: null, long: false });
    const recordingRef = useRef(false);
    const recordingLockedRef = useRef(false);
    const [recording, setRecording] = useState(false);
    const [recordingLocked, setRecordingLocked] = useState(false);
    const [shutterPressed, setShutterPressed] = useState(false);

    useEffect(() => {
        recordingRef.current = recording;
    }, [recording]);

    const clearPointerTimer = useCallback(() => {
        if (pointerRef.current.timer) {
            clearTimeout(pointerRef.current.timer);
            pointerRef.current.timer = null;
        }
    }, []);

    const clearKeyTimer = useCallback(() => {
        if (keyRef.current.timer) {
            clearTimeout(keyRef.current.timer);
            keyRef.current.timer = null;
        }
    }, []);

    const clearRecording = useCallback(() => {
        recorderRef.current = null;
        recordSessionRef.current = null;
        recordChunksRef.current = [];
        recordingRef.current = false;
        recordingLockedRef.current = false;
        setRecording(false);
        setRecordingLocked(false);
        setShutterPressed(false);
    }, []);

    const stopVideo = useCallback(() => {
        recordingLockedRef.current = false;
        setRecordingLocked(false);
        setShutterPressed(false);
        const recorder = recorderRef.current;
        if (recorder?.state === 'recording') {
            recorder.stop();
            return;
        }
        recordSessionRef.current?.stop?.();
        clearRecording();
    }, [clearRecording]);

    const startVideo = useCallback(() => {
        if (captureRef.current || recordingRef.current) return;
        if (typeof MediaRecorder === 'undefined') {
            toast.error('video recording is unavailable');
            return;
        }

        const video = webcamRef.current?.video;
        if (!video || video.readyState < 2) {
            toast.error('camera is not ready');
            return;
        }

        const mimeType = getVideoMimeType();
        let session;
        let recorder;
        try {
            session = makeRecordingStream(video);
            recorder = new MediaRecorder(session.stream, mimeType ? { mimeType } : undefined);
        } catch (error) {
            session?.stop?.();
            console.error('video recording failed:', error);
            toast.error('video recording is unavailable');
            return;
        }

        recordChunksRef.current = [];
        recordSessionRef.current = session;
        recorderRef.current = recorder;
        recordingRef.current = true;
        recordingLockedRef.current = false;
        setRecording(true);
        setRecordingLocked(false);

        recorder.ondataavailable = (event) => {
            if (event.data?.size) recordChunksRef.current.push(event.data);
        };
        recorder.onerror = () => {
            console.error('video recording failed:', recorder.error);
            session.stop();
            clearRecording();
        };
        recorder.onstop = () => {
            const chunks = recordChunksRef.current;
            const recordedType = recorder.mimeType || mimeType;
            session.stop();
            clearRecording();
            const capture = stageVideoCapture(chunks, recordedType);
            if (capture) setCapture(capture);
        };
        try {
            recorder.start();
        } catch (error) {
            session.stop();
            clearRecording();
            console.error('video recording failed:', error);
            toast.error('video recording is unavailable');
        }
    }, [captureRef, clearRecording, setCapture, webcamRef]);

    useEffect(() => () => stopVideo(), [stopVideo]);
    useEffect(() => () => clearKeyTimer(), [clearKeyTimer]);

    const lockVideo = useCallback(() => {
        if (!recordingRef.current || recordingLockedRef.current) return false;
        clearPointerTimer();
        clearKeyTimer();
        recordingLockedRef.current = true;
        setRecordingLocked(true);
        setShutterPressed(false);
        return true;
    }, [clearKeyTimer, clearPointerTimer]);

    const handleShutterKeyDown = useCallback(
        (event) => {
            if (isLockKey(event)) {
                if (recordingRef.current && !recordingLockedRef.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    lockVideo();
                }
                return;
            }

            const key = shutterKeyValue(event);
            if (!key || event.metaKey || event.ctrlKey || event.altKey) return;
            event.preventDefault();
            event.stopPropagation();

            if (keyRef.current.active) {
                if (recordingRef.current && !recordingLockedRef.current && keyRef.current.key !== key) lockVideo();
                return;
            }

            if (recordingLockedRef.current) {
                if (!event.repeat) stopVideo();
                return;
            }

            if (captureRef.current) return;
            if (recordingRef.current) {
                lockVideo();
                return;
            }

            keyRef.current.active = true;
            keyRef.current.key = key;
            keyRef.current.long = false;
            setShutterPressed(true);
            clearKeyTimer();
            keyRef.current.timer = setTimeout(() => {
                keyRef.current.timer = null;
                keyRef.current.long = true;
                startVideo();
            }, VIDEO_HOLD_MS);
        },
        [captureRef, clearKeyTimer, lockVideo, startVideo, stopVideo]
    );

    const handleShutterKeyUp = useCallback(
        (event) => {
            const key = shutterKeyValue(event);
            if (!key) return;
            event.preventDefault();
            event.stopPropagation();
            if (!keyRef.current.active) return;
            if (recordingLockedRef.current) {
                if (keyRef.current.key === key) {
                    keyRef.current.active = false;
                    keyRef.current.key = '';
                    keyRef.current.long = false;
                    setShutterPressed(false);
                    clearKeyTimer();
                }
                return;
            }
            const wasLong = keyRef.current.long;
            keyRef.current.active = false;
            keyRef.current.key = '';
            keyRef.current.long = false;
            setShutterPressed(false);
            clearKeyTimer();
            if (wasLong) {
                stopVideo();
                return;
            }
            onPhoto();
        },
        [clearKeyTimer, onPhoto, stopVideo]
    );

    const handleShutterKeyCancel = useCallback(() => {
        const wasLong = keyRef.current.long;
        keyRef.current.active = false;
        keyRef.current.key = '';
        keyRef.current.long = false;
        setShutterPressed(false);
        clearKeyTimer();
        if (wasLong && !recordingLockedRef.current) stopVideo();
    }, [clearKeyTimer, stopVideo]);

    const handleShutterDown = useCallback(
        (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (recordingLockedRef.current) {
                stopVideo();
                return;
            }
            if (captureRef.current || recordingRef.current) return;
            pointerRef.current.id = event.pointerId;
            pointerRef.current.long = false;
            pointerRef.current.startX = event.clientX;
            pointerRef.current.startY = event.clientY;
            setShutterPressed(true);
            event.currentTarget.setPointerCapture?.(event.pointerId);
            clearPointerTimer();
            pointerRef.current.timer = setTimeout(() => {
                pointerRef.current.timer = null;
                pointerRef.current.long = true;
                startVideo();
            }, VIDEO_HOLD_MS);
        },
        [captureRef, clearPointerTimer, startVideo, stopVideo]
    );

    const handleShutterMove = useCallback(
        (event) => {
            if (pointerRef.current.id !== event.pointerId) return;
            if (!recordingRef.current || recordingLockedRef.current) return;
            if (event.pointerType !== 'touch' && event.buttons === 0) return;
            if (isHorizontalLockSlide(event, pointerRef.current)) lockVideo();
        },
        [lockVideo]
    );

    const handleShutterUp = useCallback(
        (event) => {
            const active = pointerRef.current.id === event.pointerId;
            if (!active) return;
            event.preventDefault();
            event.stopPropagation();
            const wasLong = pointerRef.current.long;
            const shouldLock = wasLong && recordingRef.current && !recordingLockedRef.current && isHorizontalLockSlide(event, pointerRef.current);
            if (shouldLock) lockVideo();
            const wasLocked = recordingLockedRef.current;
            pointerRef.current.id = null;
            pointerRef.current.long = false;
            setShutterPressed(false);
            clearPointerTimer();
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            if (wasLocked) return;
            if (wasLong) {
                stopVideo();
                return;
            }
            onPhoto();
        },
        [clearPointerTimer, lockVideo, onPhoto, stopVideo]
    );

    const handleShutterCancel = useCallback(
        (event) => {
            const active = pointerRef.current.id === event.pointerId;
            const wasLong = pointerRef.current.long;
            const shouldLock = active && wasLong && recordingRef.current && !recordingLockedRef.current && isHorizontalLockSlide(event, pointerRef.current);
            if (shouldLock) lockVideo();
            const wasLocked = recordingLockedRef.current;
            pointerRef.current.id = null;
            pointerRef.current.long = false;
            setShutterPressed(false);
            clearPointerTimer();
            if (active && !wasLocked) stopVideo();
        },
        [clearPointerTimer, lockVideo, stopVideo]
    );

    return {
        recording,
        recordingLocked,
        shutterPressed,
        handleShutterCancel,
        handleShutterDown,
        handleShutterKeyCancel,
        handleShutterKeyDown,
        handleShutterKeyUp,
        handleShutterMove,
        handleShutterUp,
    };
}
