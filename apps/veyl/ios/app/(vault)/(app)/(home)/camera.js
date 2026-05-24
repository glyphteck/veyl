import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated, DeviceEventEmitter, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Camera as VCamera, CommonResolutions, useCameraDevice, useCameraPermission, useOrientation, usePhotoOutput, useVideoOutput } from 'react-native-vision-camera';
import { useBarcodeScannerOutput } from 'react-native-vision-camera-barcode-scanner';
import { scheduleOnRN } from 'react-native-worklets';
import Avatar from '@/components/avatar';
import GlassHeader from '@/components/glass/glassheader';
import GlassView from '@/components/glass/glassview';
import GlassIcon from '@/components/glass/glassicon';
import { MENU_LONG_PRESS_MS } from '@/components/menu';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { ArrowDownToLine, ArrowUpRight, Lock, MessageCircle, X } from 'lucide-react-native';
import { qr, readQr } from '@glyphteck/shared/qrutils';
import { isAddressOnNetwork } from '@glyphteck/shared/network';
import { getChatId } from '@glyphteck/shared/crypto/chat';
import { useTheme } from '@/providers/themeprovider';
import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { usePop } from '@/lib/pop';
import { useTap } from '@/lib/tap';
import { mark } from '@/lib/diagnostics';
import { CAMERA_WARM_EVENT, CAMERA_WARM_MS } from '@/lib/camerawarm';
import { alpha } from '@/lib/colors';

const BACK_REGULAR_LENS = { physicalDevices: ['wide-angle'] };
const BACK_ZOOM_LENS = { physicalDevices: ['ultra-wide-angle', 'wide-angle', 'telephoto'] };
const QR_BARCODE_FORMATS = ['qr-code'];
const NORMAL_ZOOM = 1;
const FOCUS_HOLD = 350;
const FOCUS_DRIFT = 18;
const DOUBLE_TAP_MAX_DELAY = 260;
const DOUBLE_TAP_MAX_DISTANCE = 24;
const DOUBLE_TAP_MAX_DURATION = 180;
const SHUTTER_SIZE = 82;
const SHUTTER_PRESS_SCALE = 0.9;
const SHUTTER_RECORDING_SCALE = 0.76;
const LOCK_CLAIM_DISTANCE = 10;
const LOCK_SLIDE_DISTANCE = 58;
const LOCK_AXIS_RATIO = 1.2;
const LOCK_VERTICAL_FAIL = 44;
const SHUTTER_LOCK_RETENTION = { top: 28, bottom: 28, left: LOCK_SLIDE_DISTANCE + 28, right: LOCK_SLIDE_DISTANCE + 28 };
const PREVIEW_FADE = 250;
const PREVIEW_HOLD = 2000;
const PREVIEW_CHECK = 250;
const SCAN_COOLDOWN = 700;
const ACTION_GAP = 48;
const EXIT_HOLD = 500;
const VIDEO_MIME = 'video/mp4';
const CAMERA_PHOTO_RESOLUTION = CommonResolutions.FHD_4_3;
const CAMERA_VIDEO_RESOLUTION = CommonResolutions.HD_16_9;
const INITIAL_ROUTE_STATE = {
    taking: false,
    holding: false,
    warming: false,
    recording: false,
    recordingLocked: false,
    stagedMedia: null,
};

function getPhotoDisplaySize(photo) {
    const width = Math.max(1, Math.round(Number(photo?.width) || 0));
    const height = Math.max(1, Math.round(Number(photo?.height) || 0));
    return photo?.orientation === 'left' || photo?.orientation === 'right'
        ? { width: height, height: width }
        : { width, height };
}

function clampZoom(value, min, max) {
    'worklet';
    return Math.min(max, Math.max(min, value));
}

function getRegularZoom(device) {
    const min = Number.isFinite(device?.minZoom) ? device.minZoom : NORMAL_ZOOM;
    const max = Number.isFinite(device?.maxZoom) ? device.maxZoom : NORMAL_ZOOM;
    const switchZoom = device?.zoomLensSwitchFactors?.find?.((value) => Number.isFinite(value) && value > min && value <= max);
    return clampZoom(switchZoom || NORMAL_ZOOM, min, max);
}

function getCaptureRotate(orientation) {
    if (orientation === 'left') return '90deg';
    if (orientation === 'right') return '-90deg';
    if (orientation === 'down') return '180deg';
    return '0deg';
}

function getGestureTouch(event) {
    'worklet';
    const touch = event?.allTouches?.[0] || event?.changedTouches?.[0];
    return {
        x: touch?.x ?? 0,
        y: touch?.y ?? 0,
    };
}

function getNativeTouch(event) {
    const touch = event?.nativeEvent?.changedTouches?.[0] || event?.nativeEvent?.touches?.[0] || event?.nativeEvent;
    return {
        valid: !!touch,
        x: Number(touch?.pageX ?? touch?.locationX ?? 0),
        y: Number(touch?.pageY ?? touch?.locationY ?? 0),
    };
}

function isNativeLockSlide(event, start) {
    const point = getNativeTouch(event);
    if (!point.valid) return false;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    return ax >= LOCK_SLIDE_DISTANCE && ax > ay * LOCK_AXIS_RATIO;
}

function stageCapturedPhoto(photo, uri, orientation) {
    const size = getPhotoDisplaySize(photo);
    return {
        uri,
        width: size.width,
        height: size.height,
        rotate: getCaptureRotate(orientation || photo?.orientation),
    };
}

function normalizeFileUri(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `file://${value}`;
}

function stageCapturedVideo(path, orientation) {
    const uri = normalizeFileUri(path);
    if (!uri) {
        throw new Error('video unavailable');
    }
    return {
        kind: 'video',
        uri,
        mimeType: VIDEO_MIME,
        name: `veyl-${Date.now()}.mp4`,
        rotate: getCaptureRotate(orientation),
    };
}

function StagedMediaFrame({ rotate, children }) {
    const { width: screenW, height: screenH } = useWindowDimensions();
    const sideways = rotate === '90deg' || rotate === '-90deg';

    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left: sideways ? (screenW - screenH) / 2 : 0,
                top: sideways ? (screenH - screenW) / 2 : 0,
                width: sideways ? screenH : screenW,
                height: sideways ? screenW : screenH,
                transform: [{ rotate }],
            }}
        >
            {children}
        </View>
    );
}

function StagedVideoPreview({ uri }) {
    const player = useVideoPlayer(uri ? { uri } : null, (nextPlayer) => {
        nextPlayer.loop = true;
        nextPlayer.muted = true;
        nextPlayer.audioMixingMode = 'mixWithOthers';
    });

    useEffect(() => {
        if (!uri) return undefined;
        try {
            player.play();
        } catch (error) {
            console.warn('video preview failed', error);
        }
        return undefined;
    }, [player, uri]);

    return <VideoView player={player} pointerEvents="none" nativeControls={false} contentFit="contain" fullscreenOptions={{ enable: false }} allowsVideoFrameAnalysis={false} style={{ width: '100%', height: '100%' }} />;
}

function StagedPreview({ media }) {
    return (
        <StagedMediaFrame rotate={media?.rotate || '0deg'}>
            {media?.kind === 'video' ? <StagedVideoPreview uri={media.uri} /> : <Image source={{ uri: media?.uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />}
        </StagedMediaFrame>
    );
}

function CameraSurface({ active, cameraRef, canUseZoomDevice, device, facing, onCameraError, onCameraStarted, onFlip, onFocus, onUseZoomDevice, outputs }) {
    const minZoom = Number.isFinite(device?.minZoom) ? device.minZoom : NORMAL_ZOOM;
    const maxZoom = Number.isFinite(device?.maxZoom) ? device.maxZoom : NORMAL_ZOOM;
    const regularZoom = getRegularZoom(device);
    const cameraZoom = useSharedValue(regularZoom);
    const pinchStartZoom = useSharedValue(regularZoom);
    const zoomDeviceRequested = useSharedValue(false);

    useEffect(() => {
        cameraZoom.value = regularZoom;
        pinchStartZoom.value = regularZoom;
        zoomDeviceRequested.value = false;
    }, [cameraZoom, device?.id, pinchStartZoom, regularZoom, zoomDeviceRequested]);

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
                    pinchStartZoom.value = cameraZoom.value;
                })
                .onUpdate((event) => {
                    'worklet';
                    if (canUseZoomDevice && !zoomDeviceRequested.value && (event.scale < 0.98 || event.scale > 1.08)) {
                        zoomDeviceRequested.value = true;
                        scheduleOnRN(onUseZoomDevice);
                    }
                    const nextZoom = clampZoom(pinchStartZoom.value * event.scale, minZoom, maxZoom);
                    cameraZoom.value = nextZoom;
                }),
        [cameraZoom, canUseZoomDevice, maxZoom, minZoom, onUseZoomDevice, pinchStartZoom, zoomDeviceRequested]
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
            <View style={StyleSheet.absoluteFill}>
                <VCamera
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={active}
                    outputs={outputs}
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

export default function CameraTab() {
    const { theme, isDark } = useTheme();
    const { addPeer } = usePeer() || {};
    const { settings, username, chatPK, walletPK: ownWalletPK, chatBanned } = useUser();
    const { network } = useWallet();
    const { selectChat } = useChat();
    const insets = useSafeAreaInsets();
    const isFocused = useIsFocused();
    const { hasPermission, requestPermission } = useCameraPermission();
    const captureOrientation = useOrientation('device');
    const [facing, setFacing] = useState('back');
    const [backLensMode, setBackLensMode] = useState('regular');
    const backRegularDevice = useCameraDevice('back', BACK_REGULAR_LENS);
    const backZoomDevice = useCameraDevice('back', BACK_ZOOM_LENS);
    const frontDevice = useCameraDevice('front');
    const backDevice = backLensMode === 'zoom' ? backZoomDevice || backRegularDevice : backRegularDevice || backZoomDevice;
    const device = facing === 'back' ? backDevice : frontDevice;
    const canUseBackZoomDevice = facing === 'back' && backLensMode !== 'zoom' && !!backZoomDevice && backZoomDevice.id !== backDevice?.id;
    const photoOutput = usePhotoOutput({ targetResolution: CAMERA_PHOTO_RESOLUTION, qualityPrioritization: 'speed' });
    const videoOutput = useVideoOutput({ targetResolution: CAMERA_VIDEO_RESOLUTION, fileType: 'mp4', enablePersistentRecorder: true });
    const cameraRef = useRef(null);
    const exitTimerRef = useRef(null);
    const warmTimerRef = useRef(null);
    const routeLockRef = useRef(false);
    const recorderRef = useRef(null);
    const recordingRef = useRef(false);
    const recordingLockedRef = useRef(false);
    const lockPendingRef = useRef(false);
    const lockReleasePendingRef = useRef(false);
    const shutterHeldRef = useRef(false);
    const shutterStartRef = useRef({ x: 0, y: 0 });
    const orientationRef = useRef('up');
    const recordingOrientationRef = useRef('up');
    const recordingTokenRef = useRef(0);
    const stopAfterStartRef = useRef(false);
    const mountedRef = useRef(true);
    const previewRef = useRef({
        key: '',
        timer: null,
        loading: false,
        seenAt: 0,
    });
    const scanRef = useRef({
        raw: '',
        time: 0,
        busy: false,
    });
    const [previewPeer, setPreviewPeer] = useState(null);
    const [previewVisible, setPreviewVisible] = useState(false);
    const [cameraReady, setCameraReady] = useState(false);
    const [routeState, setRouteState] = useState(INITIAL_ROUTE_STATE);
    const { taking, holding, recording, recordingLocked, warming, stagedMedia } = routeState;
    const wasOpenRef = useRef(false);
    const previewOpacity = useSharedValue(0);
    const lockGestureEnabled = useSharedValue(false);
    const lockGestureActive = useSharedValue(false);
    const lockStartX = useSharedValue(0);
    const lockStartY = useSharedValue(0);
    const shutterScale = useRef(new RNAnimated.Value(1)).current;
    const settingsFeedback = useTap();
    const pageOpen = isFocused;

    const updateRouteState = useCallback((patch) => {
        if (!mountedRef.current) return;
        setRouteState((current) => {
            const nextPatch = typeof patch === 'function' ? patch(current) : patch;
            if (!nextPatch || typeof nextPatch !== 'object') return current;
            let changed = false;
            for (const key of Object.keys(nextPatch)) {
                if (current[key] !== nextPatch[key]) {
                    changed = true;
                    break;
                }
            }
            if (!changed) return current;
            return { ...current, ...nextPatch };
        });
    }, []);

    const animateShutter = useCallback(
        (toValue) => {
            RNAnimated.spring(shutterScale, {
                toValue,
                useNativeDriver: true,
                speed: 22,
                bounciness: 8,
            }).start();
        },
        [shutterScale]
    );

    const setShutterHeldValue = useCallback((nextHeld) => {
        shutterHeldRef.current = nextHeld;
    }, []);

    useEffect(() => {
        if (captureOrientation) orientationRef.current = captureOrientation;
    }, [captureOrientation]);

    const clearWarm = useCallback(() => {
        if (warmTimerRef.current) {
            clearTimeout(warmTimerRef.current);
            warmTimerRef.current = null;
        }
        updateRouteState({ warming: false });
    }, [updateRouteState]);

    const startWarm = useCallback(
        (ms = CAMERA_WARM_MS) => {
            if (pageOpen) return;
            const duration = Number(ms);
            const hold = Number.isFinite(duration) && duration > 0 ? duration : CAMERA_WARM_MS;

            if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
            updateRouteState({ warming: true });
            warmTimerRef.current = setTimeout(() => {
                warmTimerRef.current = null;
                updateRouteState({ warming: false });
            }, hold);
        },
        [pageOpen, updateRouteState]
    );

    useEffect(() => {
        if (pageOpen && hasPermission === false) requestPermission();
    }, [hasPermission, pageOpen, requestPermission]);

    useEffect(() => {
        const sub = DeviceEventEmitter.addListener(CAMERA_WARM_EVENT, (payload = {}) => {
            startWarm(payload?.ms);
        });
        return () => sub.remove();
    }, [startWarm]);

    useEffect(
        () => () => {
            mountedRef.current = false;
            if (previewRef.current.timer) clearTimeout(previewRef.current.timer);
            if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
            if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
            recorderRef.current?.stopRecording?.().catch?.(() => {});
        },
        []
    );

    useEffect(() => {
        previewOpacity.value = withTiming(previewVisible ? 1 : 0, { duration: PREVIEW_FADE });
    }, [previewOpacity, previewVisible]);

    useEffect(() => {
        if (pageOpen) {
            clearWarm();
            return;
        }
        if (previewRef.current.timer) {
            clearTimeout(previewRef.current.timer);
            previewRef.current.timer = null;
        }
        previewRef.current.key = '';
        previewRef.current.loading = false;
        previewRef.current.seenAt = 0;
        scanRef.current.raw = '';
        scanRef.current.time = 0;
        scanRef.current.busy = false;
        setPreviewVisible(false);
        setCameraReady(false);
    }, [clearWarm, pageOpen]);

    useEffect(() => {
        if (pageOpen) {
            wasOpenRef.current = true;
            if (exitTimerRef.current) {
                clearTimeout(exitTimerRef.current);
                exitTimerRef.current = null;
            }
            updateRouteState({ holding: false });
            return;
        }
        if (!wasOpenRef.current) return;

        wasOpenRef.current = false;
        setBackLensMode('regular');
        updateRouteState({ holding: true });
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        exitTimerRef.current = setTimeout(() => {
            exitTimerRef.current = null;
            updateRouteState({ holding: false });
        }, EXIT_HOLD);
    }, [pageOpen, updateRouteState]);

    const previewStyle = useAnimatedStyle(() => ({ opacity: previewOpacity.value }));

    const flipCamera = useCallback(() => {
        if (taking || stagedMedia) {
            mark('camera.flip.blocked', { taking, staged: stagedMedia?.kind || '' });
            return;
        }
        if (recordingRef.current && (!recorderRef.current || stopAfterStartRef.current)) {
            mark('camera.flip.blocked', { recording: true, recorderReady: !!recorderRef.current, stopAfterStart: !!stopAfterStartRef.current });
            return;
        }
        mark('camera.flip', { from: facing, to: facing === 'back' ? 'front' : 'back', deviceId: device?.id || '' });
        setBackLensMode('regular');
        setFacing((current) => (current === 'back' ? 'front' : 'back'));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, [device?.id, facing, stagedMedia, taking]);

    const useBackZoomDevice = useCallback(() => {
        if (facing !== 'back' || !backZoomDevice) return;
        mark('camera.zoomDevice', { from: device?.id || '', to: backZoomDevice.id || '' });
        setBackLensMode('zoom');
    }, [backZoomDevice, device?.id, facing]);

    const handleFocus = useCallback(
        async (x, y) => {
            if (!device?.supportsFocusMetering || !cameraRef.current) return;
            Haptics.selectionAsync().catch(() => {});

            try {
                await cameraRef.current.focusTo({ x, y }, { responsiveness: 'snappy' });
            } catch (err) {
                console.warn('focus failed', err);
            }
        },
        [device?.supportsFocusMetering]
    );

    const clearPreviewTimer = useCallback(() => {
        if (!previewRef.current.timer) return;
        clearTimeout(previewRef.current.timer);
        previewRef.current.timer = null;
    }, []);

    const hidePreview = useCallback(() => {
        clearPreviewTimer();
        previewRef.current.key = '';
        previewRef.current.seenAt = 0;
        setPreviewVisible(false);
    }, [clearPreviewTimer]);

    const takePicture = useCallback(async () => {
        if (taking || recordingRef.current) return;

        let photo;
        try {
            mark('camera.photo.start', { deviceId: device?.id || '', facing, orientation: orientationRef.current });
            updateRouteState({ taking: true });
            photo = await photoOutput.capturePhoto({ enableShutterSound: true }, {});
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            const path = await photo.saveToTemporaryFileAsync();
            const uri = path.startsWith('file://') ? path : `file://${path}`;
            mark('camera.photo.done', { width: photo?.width || 0, height: photo?.height || 0, orientation: photo?.orientation || '' });
            updateRouteState({ stagedMedia: { kind: 'photo', ...stageCapturedPhoto(photo, uri, orientationRef.current) } });
        } catch (err) {
            mark('camera.photo.error', { message: err?.message || String(err) });
            console.warn('take picture failed', err);
            Alert.alert('Capture failed', 'Could not take the photo.');
        } finally {
            photo?.dispose();
            updateRouteState({ taking: false });
        }
    }, [device?.id, facing, photoOutput, taking, updateRouteState]);

    const clearRecording = useCallback((token = recordingTokenRef.current) => {
        if (token !== recordingTokenRef.current) return;
        recorderRef.current = null;
        recordingRef.current = false;
        recordingLockedRef.current = false;
        lockPendingRef.current = false;
        lockReleasePendingRef.current = false;
        setShutterHeldValue(false);
        lockGestureEnabled.value = false;
        stopAfterStartRef.current = false;
        updateRouteState({ recording: false, recordingLocked: false });
        animateShutter(1);
    }, [animateShutter, lockGestureEnabled, setShutterHeldValue, updateRouteState]);

    const stopVideoRecording = useCallback(() => {
        mark('camera.video.stop', { recording: !!recordingRef.current, hasRecorder: !!recorderRef.current, locked: !!recordingLockedRef.current });
        setShutterHeldValue(false);
        recordingLockedRef.current = false;
        lockPendingRef.current = false;
        lockReleasePendingRef.current = false;
        lockGestureEnabled.value = false;
        updateRouteState({ recordingLocked: false });
        if (!recordingRef.current && !recorderRef.current) {
            stopAfterStartRef.current = false;
            animateShutter(1);
            return;
        }
        stopAfterStartRef.current = true;
        updateRouteState({ recording: false });
        animateShutter(1);
        const recorder = recorderRef.current;
        if (!recorder?.stopRecording) return;
        recorder.stopRecording().catch((error) => {
            mark('camera.video.stop.error', { message: error?.message || String(error) });
            console.warn('stop video recording failed', error);
            clearRecording();
        });
    }, [animateShutter, clearRecording, lockGestureEnabled, setShutterHeldValue, updateRouteState]);

    const lockVideoRecording = useCallback((ignoreNextRelease = true) => {
        if (!recordingRef.current || recordingLockedRef.current) {
            lockPendingRef.current = false;
            return;
        }
        recordingLockedRef.current = true;
        lockPendingRef.current = false;
        lockReleasePendingRef.current = ignoreNextRelease;
        setShutterHeldValue(false);
        lockGestureEnabled.value = false;
        updateRouteState({ recordingLocked: true });
        animateShutter(SHUTTER_PRESS_SCALE);
        Haptics.selectionAsync().catch(() => {});
    }, [animateShutter, lockGestureEnabled, setShutterHeldValue, updateRouteState]);

    const beginLockVideoRecording = useCallback((ignoreNextRelease = true) => {
        lockPendingRef.current = true;
        setShutterHeldValue(false);
        lockVideoRecording(ignoreNextRelease);
    }, [lockVideoRecording, setShutterHeldValue]);

    const startVideoRecording = useCallback(async () => {
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
        stopAfterStartRef.current = false;
        updateRouteState({ recording: true });
        lockGestureEnabled.value = true;
        animateShutter(SHUTTER_RECORDING_SCALE);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

        try {
            mark('camera.video.start', { deviceId: device?.id || '', facing, orientation: recordingOrientationRef.current });
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
                    clearRecording(token);
                    try {
                        const video = stageCapturedVideo(path, recordingOrientationRef.current);
                        mark('camera.video.done', { uri: video.uri, orientation: recordingOrientationRef.current });
                        updateRouteState({ stagedMedia: video });
                    } catch (error) {
                        mark('camera.video.stage.error', { message: error?.message || String(error) });
                        console.warn('stage video failed', error);
                        if (mountedRef.current) Alert.alert('Capture failed', 'Could not record the video.');
                    }
                },
                (error) => {
                    if (token !== recordingTokenRef.current) return;
                    clearRecording(token);
                    mark('camera.video.record.error', { message: error?.message || String(error) });
                    console.warn('record video failed', error);
                    if (mountedRef.current) Alert.alert('Capture failed', 'Could not record the video.');
                }
            );

            if (stopAfterStartRef.current || (!shutterHeldRef.current && !recordingLockedRef.current)) {
                stopVideoRecording();
            }
        } catch (error) {
            if (token !== recordingTokenRef.current) return;
            clearRecording(token);
            mark('camera.video.start.error', { message: error?.message || String(error) });
            console.warn('start video recording failed', error);
            if (mountedRef.current) Alert.alert('Capture failed', 'Could not record the video.');
        }
    }, [animateShutter, clearRecording, device?.id, facing, hidePreview, lockGestureEnabled, previewVisible, stagedMedia, stopVideoRecording, taking, updateRouteState, videoOutput]);

    const handleCameraStarted = useCallback(() => {
        mark('camera.started', { deviceId: device?.id || '', facing });
        setCameraReady(true);
    }, [device?.id, facing]);

    const handleCameraError = useCallback((error) => {
        mark('camera.error', { deviceId: device?.id || '', facing, message: error?.message || String(error), code: error?.code || '' });
        console.warn('camera failed', error);
    }, [device?.id, facing]);

    useEffect(() => {
        const sub = DeviceEventEmitter.addListener('photosent', () => updateRouteState({ stagedMedia: null }));
        return () => sub.remove();
    }, [updateRouteState]);

    const discardStaged = useCallback(() => {
        updateRouteState({ stagedMedia: null });
    }, [updateRouteState]);

    const handleSendStaged = useCallback(() => {
        if (!stagedMedia) return;
        router.navigate({
            pathname: '/sendphoto',
            params: {
                uri: stagedMedia.uri,
                w: stagedMedia.width || '',
                h: stagedMedia.height || '',
                t: stagedMedia.kind === 'video' ? 'mp4' : 'img',
                n: stagedMedia.name || '',
            },
        });
    }, [stagedMedia]);

    const handleSaveStaged = useCallback(async () => {
        if (!stagedMedia) return;
        try {
            const existing = await MediaLibrary.getPermissionsAsync(true);
            const perm = existing.granted ? existing : await MediaLibrary.requestPermissionsAsync(true);
            if (!perm.granted) {
                Alert.alert('Permission needed', 'Please allow photo access to save media.');
                return;
            }
            await MediaLibrary.saveToLibraryAsync(stagedMedia.uri);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } catch (err) {
            console.warn('save failed', err);
            Alert.alert('Save failed', 'Could not save this media.');
        }
    }, [stagedMedia]);

    const holdPreview = useCallback(
        (key) => {
            const seenAt = Date.now();
            previewRef.current.key = key;
            previewRef.current.seenAt = seenAt;
            setPreviewVisible((visible) => (visible ? visible : true));
            clearPreviewTimer();

            const check = () => {
                const preview = previewRef.current;
                if (preview.key !== key) return;

                const remaining = PREVIEW_HOLD - (Date.now() - preview.seenAt);
                if (remaining <= 0) {
                    preview.timer = null;
                    preview.key = '';
                    preview.seenAt = 0;
                    setPreviewVisible(false);
                    return;
                }

                preview.timer = setTimeout(check, Math.min(remaining, PREVIEW_CHECK));
            };

            previewRef.current.timer = setTimeout(check, PREVIEW_CHECK);
        },
        [clearPreviewTimer]
    );

    const lockRoute = useCallback((ms = 2000) => {
        if (routeLockRef.current) return false;
        routeLockRef.current = true;
        setTimeout(() => {
            routeLockRef.current = false;
        }, ms);
        return true;
    }, []);

    const showUserPreview = useCallback(
        async (nextUsername) => {
            if (!nextUsername || nextUsername === username) return;

            const key = `user:${nextUsername}`;
            if (previewRef.current.key === key) {
                return;
            }
            if (previewRef.current.loading || routeLockRef.current) return;

            previewRef.current.loading = true;

            try {
                const peer = await addPeer?.({ username: nextUsername });
                if (!peer) throw new Error('user not found');
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setPreviewPeer(peer);
                holdPreview(key);
            } catch (_error) {
                previewRef.current.key = '';
                previewRef.current.seenAt = 0;
                Alert.alert('Scan failed', 'Could not open this user.');
            } finally {
                previewRef.current.loading = false;
            }
        },
        [addPeer, holdPreview, username]
    );

    const handleShutterPress = useCallback(() => {
        if (recordingLockedRef.current) {
            Haptics.selectionAsync().catch(() => {});
            stopVideoRecording();
            return;
        }
        if (recordingRef.current || recording) {
            return;
        }
        if (previewVisible) {
            hidePreview();
            return;
        }
        takePicture();
    }, [hidePreview, previewVisible, recording, stopVideoRecording, takePicture]);

    const handleShutterPressIn = useCallback((event) => {
        if (taking) return;
        shutterStartRef.current = getNativeTouch(event);
        setShutterHeldValue(true);
        animateShutter(recordingLockedRef.current ? SHUTTER_RECORDING_SCALE : SHUTTER_PRESS_SCALE);
    }, [animateShutter, setShutterHeldValue, taking]);

    const handleShutterMove = useCallback(
        (event) => {
            if (!recordingRef.current || recordingLockedRef.current || lockPendingRef.current) return;
            if (isNativeLockSlide(event, shutterStartRef.current)) {
                beginLockVideoRecording();
            }
        },
        [beginLockVideoRecording]
    );

    const handleShutterRelease = useCallback((event) => {
        if (recordingLockedRef.current) {
            if (lockReleasePendingRef.current) {
                lockReleasePendingRef.current = false;
                animateShutter(SHUTTER_PRESS_SCALE);
                return;
            }
            Haptics.selectionAsync().catch(() => {});
            stopVideoRecording();
            return;
        }
        if (lockPendingRef.current) {
            animateShutter(SHUTTER_PRESS_SCALE);
            return;
        }
        if (recordingRef.current && isNativeLockSlide(event, shutterStartRef.current)) {
            beginLockVideoRecording(false);
            return;
        }
        if (recordingRef.current && !lockGestureEnabled.value) {
            return;
        }
        if (recordingRef.current && lockGestureActive.value) {
            return;
        }
        if (recordingRef.current || recorderRef.current || recording) {
            stopVideoRecording();
            return;
        }
        setShutterHeldValue(false);
        animateShutter(1);
    }, [animateShutter, beginLockVideoRecording, lockGestureActive, lockGestureEnabled, recording, setShutterHeldValue, stopVideoRecording]);

    const handleShutterCancel = useCallback((event) => {
        if (recordingLockedRef.current) {
            if (lockReleasePendingRef.current) {
                lockReleasePendingRef.current = false;
            }
            animateShutter(SHUTTER_PRESS_SCALE);
            return;
        }
        if (lockPendingRef.current) {
            animateShutter(SHUTTER_PRESS_SCALE);
            return;
        }
        if (recordingRef.current && isNativeLockSlide(event, shutterStartRef.current)) {
            beginLockVideoRecording(false);
            return;
        }
        if (recordingRef.current && !lockGestureEnabled.value) {
            return;
        }
        if (recordingRef.current && lockGestureActive.value) {
            return;
        }
        if (recordingRef.current || recorderRef.current || recording) {
            stopVideoRecording();
            return;
        }
        setShutterHeldValue(false);
        animateShutter(1);
    }, [animateShutter, beginLockVideoRecording, lockGestureActive, lockGestureEnabled, recording, setShutterHeldValue, stopVideoRecording]);

    const handlePreviewChat = useCallback(() => {
        if (chatBanned) {
            return;
        }
        if (!previewPeer?.chatPK || !chatPK) {
            Alert.alert('Missing chat key', 'This person has no chat key yet.');
            return;
        }
        if (!lockRoute()) return;

        const chatId = getChatId(chatPK, previewPeer.chatPK);
        hidePreview();
        selectChat?.(chatId);
        router.navigate({ pathname: '/currentchat', params: { id: chatId } });
    }, [chatBanned, chatPK, hidePreview, lockRoute, previewPeer, selectChat]);

    const handlePreviewSend = useCallback(() => {
        if (!previewPeer?.walletPK) {
            Alert.alert('Missing address', 'This person has no wallet key yet.');
            return;
        }
        if (!lockRoute()) return;

        hidePreview();
        router.navigate({
            pathname: '/transfer',
            params: {
                uid: previewPeer?.uid ?? '',
                walletPK: previewPeer.walletPK,
            },
        });
    }, [hidePreview, lockRoute, previewPeer]);

    const handleScanResult = useCallback(
        async (data) => {
            if (!pageOpen || recordingRef.current || !data) return;
            const raw = data.trim();
            if (!raw) return;

            const now = Date.now();
            const last = scanRef.current;
            if (last.busy) return;

            const qrData = readQr(raw);

            if (qrData?.kind === qr.user && qrData.username) {
                const key = `user:${qrData.username}`;
                if (previewRef.current.key === key) {
                    holdPreview(key);
                    last.raw = raw;
                    last.time = now;
                    return;
                }

                if (now - last.time < SCAN_COOLDOWN) return;

                last.raw = raw;
                last.time = now;
                last.busy = true;

                try {
                    await showUserPreview(qrData.username);
                } finally {
                    last.busy = false;
                }
                return;
            }

            if (now - last.time < SCAN_COOLDOWN) return;

            last.raw = raw;
            last.time = now;
            last.busy = true;

            try {
                if (previewRef.current.loading || routeLockRef.current) return;

                if (qrData?.kind === qr.request && qrData.to === ownWalletPK) {
                    return;
                }

                if (qrData?.kind === qr.request && qrData.to) {
                    hidePreview();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    if (!lockRoute()) return;

                    const auto = settings?.sendOnScan === true && !!qrData.amount;
                    if (qrData.amount) {
                        router.navigate({
                            pathname: '/transfer',
                            params: {
                                walletPK: qrData.to,
                                amount: qrData.amount,
                                send: '1',
                                auto: auto ? '1' : '0',
                            },
                        });
                    } else {
                        let peer = null;
                        try {
                            peer = await addPeer?.({ walletPK: qrData.to });
                        } catch (error) {
                            console.warn('peer lookup failed', error);
                        }
                        router.navigate({
                            pathname: '/transfer',
                            params: {
                                uid: peer?.uid ?? '',
                                walletPK: peer?.walletPK ?? qrData.to,
                                send: '1',
                            },
                        });
                    }
                    return;
                }

                if (qrData?.kind === qr.bitcoin && qrData.address) {
                    if (!isAddressOnNetwork(qrData.address, network)) {
                        console.warn(`ignoring wrong-network bitcoin qr (active: ${network})`);
                        return;
                    }
                    hidePreview();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    if (!lockRoute()) return;
                    router.navigate({ pathname: '/withdraw', params: { address: qrData.address } });
                    return;
                }
            } finally {
                scanRef.current.busy = false;
            }
        },
        [addPeer, hidePreview, lockRoute, network, ownWalletPK, pageOpen, settings?.sendOnScan, showUserPreview]
    );

    const barcodeOutput = useBarcodeScannerOutput({
        barcodeFormats: QR_BARCODE_FORMATS,
        outputResolution: 'preview',
        onBarcodeScanned: (barcodes) => {
            if (recordingRef.current) return;
            const barcode = barcodes[0];
            if (barcode) handleScanResult(barcode.rawValue ?? barcode.displayValue ?? '');
        },
        onError: (error) => {
            mark('camera.scan.error', { message: error?.message || String(error) });
            console.warn('qr scan failed', error);
        },
    });

    const active = pageOpen || warming || holding;
    const cameraOutputs = useMemo(() => [photoOutput, videoOutput, barcodeOutput], [barcodeOutput, photoOutput, videoOutput]);
    useEffect(() => {
        mark('camera.state', {
            pageOpen,
            active,
            facing,
            backLensMode,
            deviceId: device?.id || '',
            devicePosition: device?.position || '',
            hasFront: !!frontDevice,
            hasBackRegular: !!backRegularDevice,
            hasBackZoom: !!backZoomDevice,
            cameraReady,
            taking,
            recording,
            recordingLocked,
            staged: stagedMedia?.kind || '',
            outputs: cameraOutputs.length,
        });
    }, [active, backLensMode, backRegularDevice, backZoomDevice, cameraOutputs.length, cameraReady, device?.id, device?.position, facing, frontDevice, pageOpen, recording, recordingLocked, stagedMedia?.kind, taking]);
    const canPreviewChat = previewVisible && !!previewPeer?.chatPK && !!chatPK && !chatBanned;
    const canPreviewSend = previewVisible && !!previewPeer?.walletPK;
    const chatPop = usePop({ show: canPreviewChat, width: 56, gapAfter: ACTION_GAP, enterBounce: 12, exitDuration: 130 });
    const sendPop = usePop({ show: canPreviewSend, width: 56, gapBefore: ACTION_GAP, enterBounce: 12, exitDuration: 130 });
    const controlsBottom = insets.bottom + 102;
    const shutterTint = recording ? alpha(theme.destructive, 72) : previewPeer ? 'transparent' : isDark ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.20)';
    const shutterFrame = {
        width: SHUTTER_SIZE,
        height: SHUTTER_SIZE,
        borderRadius: SHUTTER_SIZE / 2,
        overflow: 'hidden',
    };
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
                        scheduleOnRN(beginLockVideoRecording);
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
                        scheduleOnRN(beginLockVideoRecording);
                    }
                })
                .onFinalize(() => {
                    'worklet';
                    const shouldStopRecording = lockGestureActive.value && lockGestureEnabled.value;
                    lockGestureActive.value = false;
                    if (shouldStopRecording) {
                        scheduleOnRN(stopVideoRecording);
                    }
                }),
        [beginLockVideoRecording, lockGestureActive, lockGestureEnabled, lockStartX, lockStartY, stopVideoRecording]
    );
    const shutterPressable = (
        <Pressable
            disabled={taking}
            delayLongPress={MENU_LONG_PRESS_MS}
            pressRetentionOffset={SHUTTER_LOCK_RETENTION}
            onPress={handleShutterPress}
            onLongPress={startVideoRecording}
            onPressIn={handleShutterPressIn}
            onPressOut={handleShutterRelease}
            onTouchCancel={handleShutterCancel}
            onTouchMove={handleShutterMove}
        >
            <RNAnimated.View
                style={{
                    ...shutterFrame,
                    transform: [{ scale: shutterScale }],
                }}
            >
                <View style={[StyleSheet.absoluteFill, shutterFrame]} pointerEvents="none">
                    {previewPeer ? (
                        <Reanimated.View style={[StyleSheet.absoluteFill, previewStyle]}>
                            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                                <Avatar source={previewPeer.avatar ? { uri: previewPeer.avatar } : null} size={SHUTTER_SIZE} pointerEvents="none" />
                            </View>
                        </Reanimated.View>
                    ) : null}
                    <GlassView style={[StyleSheet.absoluteFill, shutterFrame]} glassEffectStyle="clear" tintColor={shutterTint} />
                    {recordingLocked ? (
                        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                            <Lock pointerEvents="none" color={theme.foreground} size={24} strokeWidth={3} />
                        </View>
                    ) : null}
                </View>
            </RNAnimated.View>
        </Pressable>
    );

    if (!hasPermission) {
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, paddingBottom: insets.bottom }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: theme.muted, textAlign: 'center', paddingHorizontal: 32 }}>allow veyl to access your camera</Text>
                <Pressable {...settingsFeedback.props} onPress={() => Linking.openSettings()}>
                    <RNAnimated.View
                        style={{
                            paddingVertical: 16,
                            paddingHorizontal: 28,
                            borderRadius: 999,
                            alignItems: 'center',
                            backgroundColor: theme.foreground,
                            transform: [{ scale: settingsFeedback.scale }],
                        }}
                    >
                        <Text style={{ color: theme.background, fontSize: 18, fontWeight: '900' }}>open settings</Text>
                    </RNAnimated.View>
                </Pressable>
            </View>
        );
    }

    if (!device) return <View style={{ flex: 1 }} />;

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <CameraSurface
                key={device.id}
                active={active}
                cameraRef={cameraRef}
                canUseZoomDevice={canUseBackZoomDevice}
                device={device}
                facing={facing}
                onCameraError={handleCameraError}
                onCameraStarted={handleCameraStarted}
                onFlip={flipCamera}
                onFocus={handleFocus}
                onUseZoomDevice={useBackZoomDevice}
                outputs={cameraOutputs}
            />
            <GlassHeader style={{ height: insets.top }} pointerEvents="none" />
            {stagedMedia ? (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }]} pointerEvents="box-none">
                    <StagedPreview media={stagedMedia} />
                    <View style={{ position: 'absolute', bottom: controlsBottom, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: ACTION_GAP }}>
                        <GlassIcon glassEffectStyle="clear" icon={X} visible duration={PREVIEW_FADE} onPress={discardStaged} />
                        <GlassIcon glassEffectStyle="clear" icon={ArrowUpRight} iconSize={32} size={SHUTTER_SIZE} visible duration={PREVIEW_FADE} accent onPress={handleSendStaged} />
                        <GlassIcon glassEffectStyle="clear" icon={ArrowDownToLine} visible duration={PREVIEW_FADE} onPress={handleSaveStaged} />
                    </View>
                </View>
            ) : null}
            {!stagedMedia ? (
                <View style={{ position: 'absolute', bottom: controlsBottom, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <RNAnimated.View pointerEvents={chatPop.pointerEvents} style={[chatPop.style, { alignItems: 'center', justifyContent: 'center', overflow: 'visible' }]}>
                        <RNAnimated.View style={chatPop.childStyle}>
                            <GlassIcon glassEffectStyle="clear" icon={MessageCircle} onPress={() => canPreviewChat && handlePreviewChat()} />
                        </RNAnimated.View>
                    </RNAnimated.View>
                    <View style={{ width: SHUTTER_SIZE, height: SHUTTER_SIZE, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
                        {recordingLocked ? shutterPressable : <GestureDetector gesture={lockGesture}>{shutterPressable}</GestureDetector>}
                    </View>
                    <RNAnimated.View pointerEvents={sendPop.pointerEvents} style={[sendPop.style, { alignItems: 'center', justifyContent: 'center', overflow: 'visible' }]}>
                        <RNAnimated.View style={sendPop.childStyle}>
                            <GlassIcon glassEffectStyle="clear" icon={ArrowUpRight} iconSize={32} onPress={() => canPreviewSend && handlePreviewSend()} />
                        </RNAnimated.View>
                    </RNAnimated.View>
                </View>
            ) : null}
        </View>
    );
}
