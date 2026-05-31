import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated, DeviceEventEmitter, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import { router, useIsFocused, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Camera as VCamera, CommonResolutions, useCameraDevice, useCameraPermission, useOrientation, usePhotoOutput, useVideoOutput } from 'react-native-vision-camera';
import { useBarcodeScannerOutput } from 'react-native-vision-camera-barcode-scanner';
import { scheduleOnRN } from 'react-native-worklets';
import Avatar from '@/components/avatar';
import GlassHeader from '@/components/glass/glassheader';
import GlassView from '@/components/glass/glassview';
import GlassIcon from '@/components/glass/glassicon';
import GlassButton from '@/components/glass/glassbutton';
import { MENU_LONG_PRESS_MS } from '@/components/menu';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { ArrowDownToLine, ArrowUpRight, Lock, MessageCircle, X } from 'lucide-react-native';
import { qr, readQr } from '@veyl/shared/qr';
import { isAddressOnNetwork } from '@veyl/shared/network';
import { getChatId } from '@veyl/shared/crypto/chat';
import { randomFilename } from '@veyl/shared/utils/filename';
import { fileUri } from '@/lib/file';
import { readLastCameraFacing, writeLastCameraFacing } from '@veyl/shared/cache/localdata';
import { canSendOnScan } from '@veyl/shared/settings';
import { useTheme } from '@/providers/themeprovider';
import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { useWallet } from '@/providers/walletprovider';
import { usePop } from '@/lib/pop';
import { mark } from '@/lib/diagnostics';
import { useCameraWarming } from '@/lib/camera/warming';
import { useRouteLock } from '@/lib/navigation/routelock';
import { alpha } from '@/lib/colors';

const BACK_REGULAR_LENS = { physicalDevices: ['wide-angle'] };
const BACK_WIDEST_LENS = { physicalDevices: ['ultra-wide-angle', 'wide-angle', 'telephoto'] };
const QR_BARCODE_FORMATS = ['qr-code'];
const NORMAL_ZOOM = 1;
const MAX_CAMERA_ZOOM = 6;
const PINCH_ULTRA_WIDE_SCALE = 0.72;
const PINCH_REGULAR_SCALE = 1.35;
const LENS_SWITCH_SETTLE_MS = 500;
const LENS_SWITCH_COOLDOWN = 1400;
const SIDE_SWITCH_COOLDOWN = 320;
const SIDE_SWITCH_BUSY_MS = 450;
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
const VIDEO_MIME = 'video/mp4';
const CAMERA_PHOTO_RESOLUTION = CommonResolutions.FHD_4_3;
const CAMERA_VIDEO_RESOLUTION = CommonResolutions.HD_16_9;
const INITIAL_ROUTE_STATE = {
    taking: false,
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

function getInitialZoom(device) {
    const min = Number.isFinite(device?.minZoom) ? device.minZoom : NORMAL_ZOOM;
    const max = Number.isFinite(device?.maxZoom) ? device.maxZoom : NORMAL_ZOOM;
    return clampZoom(min, min, max);
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
        name: randomFilename('jpg'),
        rotate: getCaptureRotate(orientation || photo?.orientation),
    };
}

function stageCapturedVideo(path, orientation) {
    const uri = fileUri(path);
    if (!uri) {
        throw new Error('video unavailable');
    }
    return {
        kind: 'video',
        uri,
        mimeType: VIDEO_MIME,
        name: randomFilename('mp4'),
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

function CameraSurface({ active, cameraRef, canUseUltraWide, device, facing, isUltraWide, onCameraError, onCameraStarted, onCancelLensSwitch, onFlip, onFocus, onUseRegularLens, onUseUltraWide, outputs }) {
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

function CameraContent({ cameraActive, pageOpen, warming }) {
    const { theme, isDark } = useTheme();
    const { addPeer } = usePeer() || {};
    const { settings, username, chatPK, walletPK: ownWalletPK, chatBanned } = useUser();
    const { localCache } = useVault();
    const { network } = useWallet();
    const { selectChat } = useChat();
    const insets = useSafeAreaInsets();
    const { hasPermission, requestPermission } = useCameraPermission();
    const pathname = usePathname();
    const captureOrientation = useOrientation('device');
    const [facing, setFacing] = useState(() => readLastCameraFacing(localCache));
    const facingRef = useRef(facing);
    const [backLensMode, setBackLensMode] = useState('ultra-wide');
    const backRegularDevice = useCameraDevice('back', BACK_REGULAR_LENS);
    const backUltraWideDevice = useCameraDevice('back', BACK_WIDEST_LENS);
    const frontDevice = useCameraDevice('front');
    const backDevice = backLensMode === 'ultra-wide' ? backUltraWideDevice || backRegularDevice : backRegularDevice || backUltraWideDevice;
    const device = facing === 'back' ? backDevice : frontDevice;
    const photoOutput = usePhotoOutput({ targetResolution: CAMERA_PHOTO_RESOLUTION, qualityPrioritization: 'speed' });
    const videoOutput = useVideoOutput({ targetResolution: CAMERA_VIDEO_RESOLUTION, fileType: 'mp4', enablePersistentRecorder: true });
    const cameraRef = useRef(null);
    const { lockRoute, routeLockedRef } = useRouteLock(2000);
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
    const lensSwitchRef = useRef(0);
    const lensSwitchTimerRef = useRef(null);
    const lensSwitchBusyRef = useRef(false);
    const sideSwitchRef = useRef(0);
    const sideSwitchBusyRef = useRef(false);
    const sideSwitchTimerRef = useRef(null);
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
    const { taking, recording, recordingLocked, stagedMedia } = routeState;
    const active = cameraActive && !stagedMedia;
    const scanOpen = pageOpen && pathname === '/camera';
    const activeRef = useRef(active);
    const pageOpenRef = useRef(pageOpen);
    const cameraReadyRef = useRef(cameraReady);
    const backLensModeRef = useRef(backLensMode);
    const backUltraWideDeviceRef = useRef(backUltraWideDevice);
    const previewOpacity = useSharedValue(0);
    const lockGestureEnabled = useSharedValue(false);
    const lockGestureActive = useSharedValue(false);
    const lockStartX = useSharedValue(0);
    const lockStartY = useSharedValue(0);
    const shutterScale = useRef(new RNAnimated.Value(1)).current;

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

    useEffect(() => {
        if (pageOpen && hasPermission === false) requestPermission();
    }, [hasPermission, pageOpen, requestPermission]);

    useEffect(
        () => () => {
            mountedRef.current = false;
            if (previewRef.current.timer) clearTimeout(previewRef.current.timer);
            if (lensSwitchTimerRef.current) clearTimeout(lensSwitchTimerRef.current);
            if (sideSwitchTimerRef.current) clearTimeout(sideSwitchTimerRef.current);
            recorderRef.current?.stopRecording?.().catch?.(() => {});
        },
        []
    );

    useEffect(() => {
        previewOpacity.value = withTiming(previewVisible ? 1 : 0, { duration: PREVIEW_FADE });
    }, [previewOpacity, previewVisible]);

    useEffect(() => {
        if (pageOpen) return;
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
    }, [pageOpen]);

    useEffect(() => {
        if (scanOpen) return;
        scanRef.current.busy = false;
    }, [scanOpen]);

    const previewStyle = useAnimatedStyle(() => ({ opacity: previewOpacity.value }));

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
    }, []);

    useEffect(() => {
        if (device?.position && device.position === facing) {
            clearSideSwitchBusy(false);
        }
    }, [clearSideSwitchBusy, device?.position, facing]);

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
    }, []);

    const flipCamera = useCallback(() => {
        if (taking || stagedMedia) {
            mark('camera.flip.blocked', { taking, staged: stagedMedia?.kind || '' });
            return;
        }
        const recordingActive = recordingRef.current || recording;
        if (recordingActive && (!recorderRef.current || stopAfterStartRef.current)) {
            mark('camera.flip.blocked', { recording: true, recorderReady: !!recorderRef.current, stopping: !!stopAfterStartRef.current });
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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, [cancelLensSwitch, device?.id, holdSideSwitchBusy, localCache, recording, stagedMedia, taking]);

    const switchBackLens = useCallback(
        (mode) => {
            if (mode !== 'regular' && mode !== 'ultra-wide') return;
            cancelLensSwitch();

            lensSwitchTimerRef.current = setTimeout(() => {
                lensSwitchTimerRef.current = null;
                if (!mountedRef.current || !pageOpenRef.current || !activeRef.current) return;
                if (facingRef.current !== 'back' || taking || stagedMedia || recordingRef.current || recording) return;
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
        [cancelLensSwitch, device?.id, recording, stagedMedia, taking]
    );

    const useUltraWide = useCallback(() => switchBackLens('ultra-wide'), [switchBackLens]);
    const useRegularLens = useCallback(() => switchBackLens('regular'), [switchBackLens]);

    useEffect(() => {
        if (pageOpen && facing === 'back' && !taking && !stagedMedia && !recording) return;
        cancelLensSwitch();
        lensSwitchBusyRef.current = false;
        if (!pageOpen || stagedMedia) clearSideSwitchBusy(false);
    }, [cancelLensSwitch, clearSideSwitchBusy, facing, pageOpen, recording, stagedMedia, taking]);

    const handleFocus = useCallback(
        async (x, y) => {
            if (!pageOpenRef.current || !activeRef.current || !cameraReadyRef.current || sideSwitchBusyRef.current || lensSwitchBusyRef.current || recordingRef.current) return;
            if (!device?.supportsFocusMetering || !cameraRef.current) return;
            const point = { x: Number(x), y: Number(y) };
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
            Haptics.selectionAsync().catch(() => {});

            try {
                await cameraRef.current.focusTo(point, { responsiveness: 'snappy' });
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

    const showUserPreview = useCallback(
        async (nextUsername) => {
            if (!nextUsername || nextUsername === username) return;

            const key = `user:${nextUsername}`;
            if (previewRef.current.key === key) {
                return;
            }
            if (previewRef.current.loading || routeLockedRef.current) return;

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
        [addPeer, holdPreview, routeLockedRef, username]
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
            Alert.alert('Chat unavailable', 'This person cannot receive messages yet.');
            return;
        }
        if (!lockRoute()) return;

        const chatId = getChatId(chatPK, previewPeer.chatPK);
        hidePreview();
        selectChat?.(chatId);
        router.navigate({ pathname: '/chat/[peerchatpk]', params: { peerchatpk: previewPeer.chatPK } });
    }, [chatBanned, chatPK, hidePreview, lockRoute, previewPeer, selectChat]);

    const handlePreviewSend = useCallback(() => {
        if (!previewPeer?.walletPK) {
            Alert.alert('Wallet unavailable', 'This person cannot receive money yet.');
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
            if (!scanOpen || recordingRef.current || !data) return;
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
                if (previewRef.current.loading || routeLockedRef.current) return;

                if (qrData?.kind === qr.request && qrData.to === ownWalletPK) {
                    return;
                }

                if (qrData?.kind === qr.request && qrData.to) {
                    hidePreview();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    if (!lockRoute()) return;

                    const auto = canSendOnScan(settings) && !!qrData.amount;
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
        [addPeer, hidePreview, lockRoute, network, ownWalletPK, routeLockedRef, scanOpen, settings?.sendOnScan, showUserPreview]
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

    const isUltraWide = facing === 'back' && backLensMode === 'ultra-wide' && !!backUltraWideDevice && device?.id === backUltraWideDevice.id;
    const canUseUltraWide = facing === 'back' && backLensMode !== 'ultra-wide' && !!backUltraWideDevice && device?.id !== backUltraWideDevice.id;
    const cameraOutputs = useMemo(() => [photoOutput, videoOutput, barcodeOutput], [barcodeOutput, photoOutput, videoOutput]);
    useEffect(() => {
        mark('camera.state', {
            pageOpen,
            warming,
            active,
            facing,
            backLensMode,
            deviceId: device?.id || '',
            devicePosition: device?.position || '',
            hasFront: !!frontDevice,
            hasBackRegular: !!backRegularDevice,
            hasBackUltraWide: !!backUltraWideDevice,
            cameraReady,
            taking,
            recording,
            recordingLocked,
            staged: stagedMedia?.kind || '',
            outputs: cameraOutputs.length,
        });
    }, [active, backLensMode, backRegularDevice, backUltraWideDevice, cameraOutputs.length, cameraReady, device?.id, device?.position, facing, frontDevice, pageOpen, recording, recordingLocked, stagedMedia?.kind, taking, warming]);
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
                <GlassButton onPress={() => Linking.openSettings()} label="open settings" glassEffectStyle="clear" />
            </View>
        );
    }

    if (!device) return <View style={{ flex: 1 }} />;

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <CameraSurface
                active={active}
                cameraRef={cameraRef}
                canUseUltraWide={canUseUltraWide}
                device={device}
                facing={facing}
                isUltraWide={isUltraWide}
                onCameraError={handleCameraError}
                onCameraStarted={handleCameraStarted}
                onCancelLensSwitch={cancelLensSwitch}
                onFlip={flipCamera}
                onFocus={handleFocus}
                onUseRegularLens={useRegularLens}
                onUseUltraWide={useUltraWide}
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

export default function CameraTab() {
    const pageOpen = useIsFocused();
    const cameraWarm = useCameraWarming(pageOpen);

    if (!cameraWarm.mounted) return <View style={{ flex: 1 }} />;

    return <CameraContent cameraActive={cameraWarm.active} pageOpen={pageOpen} warming={cameraWarm.warming} />;
}
