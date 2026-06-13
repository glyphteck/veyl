import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated, DeviceEventEmitter, Linking, StyleSheet, Text, View } from 'react-native';
import { router, useIsFocused, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonResolutions, useCameraPermission, useOrientation, usePhotoOutput, useVideoOutput } from 'react-native-vision-camera';
import GlassIcon from '@/components/glass/glassicon';
import GlassButton from '@/components/glass/glassbutton';
import GlassContainer from '@/components/glass/glasscontainer';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ArrowDownToLine, ArrowUpRight, MessageCircle, X } from 'lucide-react-native';
import { useTheme } from '@/providers/themeprovider';
import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { useWallet } from '@/providers/walletprovider';
import { usePop } from '@/lib/pop';
import { mark } from '@/lib/diagnostics';
import { CameraShutter, SHUTTER_SIZE } from '@/components/camera/shutter';
import { RECORDING_SCALE, RECORD_PRESS_SCALE, getNativeTouch, isRecordLockSlide, useRecord } from '@/lib/camera/record';
import { useScan } from '@/lib/camera/scan';
import { useCameraLens } from '@/lib/camera/lens';
import { CameraSurface } from '@/lib/camera/surface';
import { StagedPreview, stageCapturedPhoto } from '@/lib/camera/staging';
import { useCameraWarming } from '@/lib/camera/warming';
import { saveMediaToLibrary } from '@/lib/media/save';
import { useRouteLock } from '@/lib/navigation/routelock';
import { alpha } from '@/lib/colors';

const PREVIEW_FADE = 250;
const PREVIEW_HOLD = 2000;
const PREVIEW_CHECK = 250;
const ACTION_GAP = 48;
const PREVIEW_ACTION_SIZE = 56;
const PREVIEW_ACTION_EXIT = 130;
const PREVIEW_ACTION_GLASS_SPACING = 32;
const CAMERA_PHOTO_RESOLUTION = CommonResolutions.FHD_4_3;
const CAMERA_VIDEO_RESOLUTION = CommonResolutions.HD_16_9;
const INITIAL_ROUTE_STATE = {
    taking: false,
    stagedMedia: null,
};

function CameraContent({ cameraActive, pageOpen, warming }) {
    const { theme } = useTheme();
    const { addPeer } = usePeer() || {};
    const { settings, username, chatPK, walletPK: ownWalletPK, chatBanned } = useUser();
    const { localCache } = useVault();
    const { network } = useWallet();
    const { selectPeerChat } = useChat();
    const insets = useSafeAreaInsets();
    const { hasPermission, requestPermission } = useCameraPermission();
    const pathname = usePathname();
    const captureOrientation = useOrientation('device');
    const photoOutput = usePhotoOutput({ targetResolution: CAMERA_PHOTO_RESOLUTION, qualityPrioritization: 'speed' });
    const videoOutput = useVideoOutput({ targetResolution: CAMERA_VIDEO_RESOLUTION, fileType: 'mp4', enablePersistentRecorder: true });
    const cameraRef = useRef(null);
    const { lockRoute, routeLockedRef } = useRouteLock(2000);
    const orientationRef = useRef('up');
    const mountedRef = useRef(true);
    const previewRef = useRef({
        key: '',
        timer: null,
        loading: false,
        seenAt: 0,
    });
    const [previewPeer, setPreviewPeer] = useState(null);
    const [previewVisible, setPreviewVisible] = useState(false);
    const [routeState, setRouteState] = useState(INITIAL_ROUTE_STATE);
    const { taking, stagedMedia } = routeState;
    const active = cameraActive && !stagedMedia;
    const scanOpen = pageOpen && pathname === '/camera';
    const previewOpacity = useSharedValue(0);
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

    useEffect(() => {
        if (captureOrientation) orientationRef.current = captureOrientation;
    }, [captureOrientation]);

    useEffect(() => {
        if (pageOpen && hasPermission === false) requestPermission();
    }, [hasPermission, pageOpen, requestPermission]);

    useEffect(
        () => () => {
            mountedRef.current = false;
            if (previewRef.current.timer) clearTimeout(previewRef.current.timer);
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
        setPreviewVisible(false);
    }, [pageOpen]);

    const previewStyle = useAnimatedStyle(() => ({ opacity: previewOpacity.value }));

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

    const stageRecorded = useCallback((media) => {
        updateRouteState({ stagedMedia: media });
    }, [updateRouteState]);

    const {
        backLensMode,
        backRegularDevice,
        backUltraWideDevice,
        cameraReady,
        canFocus,
        canUseUltraWide,
        cancelLensSwitch,
        device,
        facing,
        flipCamera: flipCameraLens,
        frontDevice,
        handleCameraError,
        handleCameraStarted,
        isUltraWide,
        resetUnavailable: resetUnavailableLens,
        switchBackLens,
    } = useCameraLens({
        active,
        localCache,
        mountedRef,
        pageOpen,
        stagedMedia,
        taking,
    });

    const record = useRecord({
        animateShutter,
        deviceId: device?.id || '',
        facing,
        hidePreview,
        mountedRef,
        onStaged: stageRecorded,
        orientationRef,
        previewVisible,
        stagedMedia,
        taking,
        videoOutput,
    });
    const {
        beginLock: beginLockVideoRecording,
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
        setHeld: setShutterHeldValue,
        shutterStartRef,
        start: startVideoRecording,
        stop: stopVideoRecording,
        stopAfterStartRef,
    } = record;

    const flipCamera = useCallback(() => {
        flipCameraLens({ recorderRef, recording, recordingRef, stopAfterStartRef });
    }, [flipCameraLens, recorderRef, recording, recordingRef, stopAfterStartRef]);

    const useUltraWide = useCallback(() => switchBackLens('ultra-wide', { recording, recordingRef }), [recording, recordingRef, switchBackLens]);
    const useRegularLens = useCallback(() => switchBackLens('regular', { recording, recordingRef }), [recording, recordingRef, switchBackLens]);

    useEffect(() => {
        resetUnavailableLens(recording);
    }, [recording, resetUnavailableLens]);

    useEffect(() => {
        if (!recording && !recordingRef.current) return;
        videoOutput.outputOrientation = recordingOrientationRef.current || orientationRef.current;
    }, [captureOrientation, recording, recordingOrientationRef, recordingRef, videoOutput]);

    const handleFocus = useCallback(
        async (x, y) => {
            if (!canFocus({ recordingRef })) return;
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
        [canFocus, device?.supportsFocusMetering, recordingRef]
    );

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
            await saveMediaToLibrary(stagedMedia.uri);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } catch (err) {
            console.warn('save failed', err);
            Alert.alert('Save failed', err?.message || 'Could not save this media.');
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
        animateShutter(recordingLockedRef.current ? RECORDING_SCALE : RECORD_PRESS_SCALE);
    }, [animateShutter, setShutterHeldValue, taking]);

    const handleShutterMove = useCallback(
        (event) => {
            if (!recordingRef.current || recordingLockedRef.current || lockPendingRef.current) return;
            if (isRecordLockSlide(event, shutterStartRef.current)) {
                beginLockVideoRecording();
            }
        },
        [beginLockVideoRecording]
    );

    const handleShutterRelease = useCallback((event) => {
        if (recordingLockedRef.current) {
            if (lockReleasePendingRef.current) {
                lockReleasePendingRef.current = false;
                animateShutter(RECORD_PRESS_SCALE);
                return;
            }
            Haptics.selectionAsync().catch(() => {});
            stopVideoRecording();
            return;
        }
        if (lockPendingRef.current) {
            animateShutter(RECORD_PRESS_SCALE);
            return;
        }
        if (recordingRef.current && isRecordLockSlide(event, shutterStartRef.current)) {
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
            animateShutter(RECORD_PRESS_SCALE);
            return;
        }
        if (lockPendingRef.current) {
            animateShutter(RECORD_PRESS_SCALE);
            return;
        }
        if (recordingRef.current && isRecordLockSlide(event, shutterStartRef.current)) {
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

        hidePreview();
        void selectPeerChat?.(previewPeer.chatPK);
        router.navigate({ pathname: '/chat/[peerchatpk]', params: { peerchatpk: previewPeer.chatPK } });
    }, [chatBanned, chatPK, hidePreview, lockRoute, previewPeer, selectPeerChat]);

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

    const scan = useScan({
        addPeer,
        hidePreview,
        holdPreview,
        lockRoute,
        network,
        onUser: showUserPreview,
        open: scanOpen,
        ownWalletPK,
        pageOpen,
        previewRef,
        recordingRef,
        routeLockedRef,
        settings,
    });

    const cameraOutputs = useMemo(() => [photoOutput, videoOutput, scan.output], [photoOutput, scan.output, videoOutput]);
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
            scanOpen,
            staged: stagedMedia?.kind || '',
            outputs: cameraOutputs.length,
        });
    }, [active, backLensMode, backRegularDevice, backUltraWideDevice, cameraOutputs.length, cameraReady, device?.id, device?.position, facing, frontDevice, pageOpen, recording, recordingLocked, scanOpen, stagedMedia?.kind, taking, warming]);
    const canPreviewChat = previewVisible && !!previewPeer?.chatPK && !!chatPK && !chatBanned;
    const canPreviewSend = previewVisible && !!previewPeer?.walletPK;
    const chatPop = usePop({ show: canPreviewChat, width: PREVIEW_ACTION_SIZE, gapAfter: ACTION_GAP, enterBounce: 12, exitDuration: PREVIEW_ACTION_EXIT });
    const sendPop = usePop({ show: canPreviewSend, width: PREVIEW_ACTION_SIZE, gapBefore: ACTION_GAP, enterBounce: 12, exitDuration: PREVIEW_ACTION_EXIT });
    const controlsBottom = insets.bottom + 102;

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
                orientationLocked={recording || recordingRef.current}
                outputs={cameraOutputs}
            />
            {stagedMedia ? (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }]} pointerEvents="box-none">
                    <StagedPreview media={stagedMedia} />
                    <View style={{ position: 'absolute', bottom: controlsBottom, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: ACTION_GAP }}>
                        <GlassIcon glassEffectStyle="clear" icon={X} visible duration={PREVIEW_FADE} onPress={discardStaged} />
                        <GlassIcon glassEffectStyle="clear" tintColor={alpha(theme.background, 25)} icon={ArrowUpRight} iconSize={32} size={SHUTTER_SIZE} visible duration={PREVIEW_FADE} onPress={handleSendStaged} />
                        <GlassIcon glassEffectStyle="clear" icon={ArrowDownToLine} visible duration={PREVIEW_FADE} onPress={handleSaveStaged} />
                    </View>
                </View>
            ) : null}
            {!stagedMedia ? (
                <GlassContainer spacing={PREVIEW_ACTION_GLASS_SPACING} style={{ position: 'absolute', bottom: controlsBottom, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
                    <RNAnimated.View pointerEvents={chatPop.pointerEvents} style={[chatPop.style, { alignItems: 'center', justifyContent: 'center', overflow: 'visible' }]}>
                        <RNAnimated.View style={chatPop.childStyle}>
                            <GlassIcon glassEffectStyle="clear" icon={MessageCircle} visible={canPreviewChat} isInteractive onPress={() => canPreviewChat && handlePreviewChat()} />
                        </RNAnimated.View>
                    </RNAnimated.View>
                    <CameraShutter
                        disabled={taking}
                        lockGesture={lockGesture}
                        onLongPress={startVideoRecording}
                        onPress={handleShutterPress}
                        onPressIn={handleShutterPressIn}
                        onPressOut={handleShutterRelease}
                        onTouchCancel={handleShutterCancel}
                        onTouchMove={handleShutterMove}
                        previewPeer={previewPeer}
                        previewStyle={previewStyle}
                        recording={recording}
                        recordingLocked={recordingLocked}
                        scale={shutterScale}
                        theme={theme}
                    />
                    <RNAnimated.View pointerEvents={sendPop.pointerEvents} style={[sendPop.style, { alignItems: 'center', justifyContent: 'center', overflow: 'visible' }]}>
                        <RNAnimated.View style={sendPop.childStyle}>
                            <GlassIcon glassEffectStyle="clear" icon={ArrowUpRight} iconSize={32} visible={canPreviewSend} isInteractive onPress={() => canPreviewSend && handlePreviewSend()} />
                        </RNAnimated.View>
                    </RNAnimated.View>
                </GlassContainer>
            ) : null}
        </View>
    );
}

export default function CameraTab() {
    const pageOpen = useIsFocused();
    const cameraWarm = useCameraWarming(pageOpen);

    return (
        <>
            {cameraWarm.mounted ? <CameraContent cameraActive={cameraWarm.active} pageOpen={pageOpen} warming={cameraWarm.warming} /> : <View style={{ flex: 1 }} />}
        </>
    );
}
