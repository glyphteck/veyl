import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated, DeviceEventEmitter, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import { useIsFocused, useNavigationState } from '@react-navigation/native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera as VCamera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { useBarcodeScannerOutput } from 'react-native-vision-camera-barcode-scanner';
import { scheduleOnRN } from 'react-native-worklets';
import Avatar from '@/components/avatar';
import GlassHeader from '@/components/glass/glassheader';
import GlassView from '@/components/glass/glassview';
import GlassIcon from '@/components/glass/glassicon';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { ArrowDownToLine, ArrowUpRight, MessageCircle, X } from 'lucide-react-native';
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

const BACK_LENS = { physicalDevices: ['ultra-wide-angle', 'wide-angle', 'telephoto'] };
const FRONT_LENS = { physicalDevices: ['true-depth', 'wide-angle'] };
const QR_BARCODE_FORMATS = ['qr-code'];
const NORMAL_ZOOM = 1;
const FOCUS_HOLD = 350;
const FOCUS_DRIFT = 18;
const SHUTTER_SIZE = 82;
const SHUTTER_SCALE = 0.9;
const SHUTTER_IN = 'selection';
const SHUTTER_OUT = ['soft', { kind: 'selection', delay: 22 }];
const PREVIEW_FADE = 250;
const PREVIEW_HOLD = 2000;
const PREVIEW_CHECK = 250;
const SCAN_COOLDOWN = 700;
const ACTION_GAP = 48;
const EXIT_HOLD = 500;
const ADJACENT_HOLD = 1000;

function getNormalZoom(device) {
    const minZoom = Number.isFinite(device?.minZoom) ? device.minZoom : NORMAL_ZOOM;
    const maxZoom = Number.isFinite(device?.maxZoom) ? device.maxZoom : NORMAL_ZOOM;
    return Math.min(maxZoom, Math.max(minZoom, NORMAL_ZOOM));
}

export default function CameraTab() {
    const { theme, isDark } = useTheme();
    const { addPeer } = usePeer() || {};
    const { settings, username, chatPK, walletPK: ownWalletPK, chatBanned } = useUser();
    const { network } = useWallet();
    const { selectChat } = useChat();
    const insets = useSafeAreaInsets();
    const { width: screenW } = useWindowDimensions();
    const pathname = usePathname();
    const isFocused = useIsFocused();
    const nearCamera = useNavigationState((state) => {
        const cameraIndex = state.routes.findIndex((route) => route.name === 'camera');
        return cameraIndex >= 0 && Math.abs(state.index - cameraIndex) <= 1;
    });
    const { hasPermission, requestPermission } = useCameraPermission();
    const [facing, setFacing] = useState('back');
    const backDevice = useCameraDevice('back', BACK_LENS);
    const frontDevice = useCameraDevice('front', FRONT_LENS);
    const device = facing === 'back' ? backDevice : frontDevice;
    const photoOutput = usePhotoOutput({ qualityPrioritization: 'speed' });
    const cameraRef = useRef(null);
    const exitTimerRef = useRef(null);
    const warmTimerRef = useRef(null);
    const routeLockRef = useRef(false);
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
    const [taking, setTaking] = useState(false);
    const [holding, setHolding] = useState(false);
    const [warming, setWarming] = useState(false);
    const [stagedPhoto, setStagedPhoto] = useState(null);
    const wasOpenRef = useRef(false);
    const blockWarmRef = useRef(false);
    const previewOpacity = useSharedValue(0);
    const settingsFeedback = useTap();
    const shutterFeedback = useTap({ disabled: taking, scale: SHUTTER_SCALE, hapticIn: SHUTTER_IN, hapticOut: SHUTTER_OUT });
    const pageOpen = isFocused;
    const inHomeTabs = pathname === '/wallet' || pathname === '/camera' || pathname === '/chatlist' || pathname === '/profile';
    const adjacent = inHomeTabs && nearCamera && !pageOpen;

    useEffect(() => {
        if (pageOpen && hasPermission === false) requestPermission();
    }, [hasPermission, pageOpen, requestPermission]);

    useEffect(
        () => () => {
            if (previewRef.current.timer) clearTimeout(previewRef.current.timer);
            if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
            if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
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
        if (!adjacent || blockWarmRef.current) {
            if (warmTimerRef.current) {
                clearTimeout(warmTimerRef.current);
                warmTimerRef.current = null;
            }
            setWarming(false);
            return;
        }

        setWarming(true);
        if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
        warmTimerRef.current = setTimeout(() => {
            warmTimerRef.current = null;
            setWarming(false);
        }, ADJACENT_HOLD);
    }, [adjacent]);

    useEffect(() => {
        if (pageOpen) {
            wasOpenRef.current = true;
            blockWarmRef.current = false;
            if (exitTimerRef.current) {
                clearTimeout(exitTimerRef.current);
                exitTimerRef.current = null;
            }
            setHolding(false);
            return;
        }
        if (!wasOpenRef.current) return;

        wasOpenRef.current = false;
        blockWarmRef.current = true;
        setHolding(true);
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        exitTimerRef.current = setTimeout(() => {
            exitTimerRef.current = null;
            blockWarmRef.current = false;
            setHolding(false);
        }, EXIT_HOLD);
    }, [pageOpen]);

    const previewStyle = useAnimatedStyle(() => ({ opacity: previewOpacity.value }));

    const flipCamera = useCallback(() => {
        setFacing((f) => (f === 'back' ? 'front' : 'back'));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, []);

    const resetZoom = useCallback(() => {
        if (facing !== 'back') return;
        const nextZoom = getNormalZoom(device);
        requestAnimationFrame(() => {
            cameraRef.current?.startZoomAnimation?.(nextZoom, 16)?.catch?.((error) => {
                console.warn('zoom reset failed', error);
            });
        });
    }, [device, facing]);

    const doubleTapGesture = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
            scheduleOnRN(flipCamera);
        });

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

    const focusGesture = Gesture.LongPress()
        .minDuration(FOCUS_HOLD)
        .maxDistance(FOCUS_DRIFT)
        .onStart((e) => {
            scheduleOnRN(handleFocus, e.x, e.y);
        });

    const touchGesture = Gesture.Exclusive(doubleTapGesture, focusGesture);

    const takePicture = useCallback(async () => {
        if (taking) return;

        let photo;
        try {
            setTaking(true);
            photo = await photoOutput.capturePhoto({ enableShutterSound: true }, {});
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            const path = await photo.saveToTemporaryFileAsync();
            const uri = path.startsWith('file://') ? path : `file://${path}`;
            setStagedPhoto({ uri, width: photo.width, height: photo.height });
        } catch (err) {
            console.warn('take picture failed', err);
            Alert.alert('Capture failed', 'Could not take the photo.');
        } finally {
            photo?.dispose();
            setTaking(false);
        }
    }, [photoOutput, taking]);

    useEffect(() => {
        const sub = DeviceEventEmitter.addListener('photosent', () => setStagedPhoto(null));
        return () => sub.remove();
    }, []);

    const discardStaged = useCallback(() => {
        setStagedPhoto(null);
    }, []);

    const handleSendStaged = useCallback(() => {
        if (!stagedPhoto) return;
        router.navigate({
            pathname: '/sendphoto',
            params: { uri: stagedPhoto.uri, w: stagedPhoto.width || '', h: stagedPhoto.height || '' },
        });
    }, [stagedPhoto]);

    const handleSaveStaged = useCallback(async () => {
        if (!stagedPhoto) return;
        try {
            const existing = await MediaLibrary.getPermissionsAsync(true);
            const perm = existing.granted ? existing : await MediaLibrary.requestPermissionsAsync(true);
            if (!perm.granted) {
                Alert.alert('Permission needed', 'Please allow photo access to save pictures.');
                return;
            }
            await MediaLibrary.saveToLibraryAsync(stagedPhoto.uri);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } catch (err) {
            console.warn('save failed', err);
            Alert.alert('Save failed', 'Could not save the photo.');
        }
    }, [stagedPhoto]);

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
        if (previewVisible) {
            hidePreview();
            return;
        }
        takePicture();
    }, [hidePreview, previewVisible, takePicture]);

    const handlePreviewChat = useCallback(() => {
        if (chatBanned) {
            return;
        }
        if (!previewPeer?.chatPK || !chatPK) {
            Alert.alert('Missing chat key', 'This peer has no chat key yet.');
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
            Alert.alert('Missing address', 'This peer has no wallet key yet.');
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
            if (!pageOpen || !data) return;
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
            const barcode = barcodes[0];
            if (barcode) handleScanResult(barcode.rawValue ?? barcode.displayValue ?? '');
        },
        onError: (error) => {
            console.warn('qr scan failed', error);
        },
    });

    const active = pageOpen || warming || holding;
    const cameraOutputs = useMemo(() => [photoOutput, barcodeOutput], [barcodeOutput, photoOutput]);
    const canPreviewChat = previewVisible && !!previewPeer?.chatPK && !!chatPK && !chatBanned;
    const canPreviewSend = previewVisible && !!previewPeer?.walletPK;
    const chatPop = usePop({ show: canPreviewChat, width: 56, gapAfter: ACTION_GAP, enterBounce: 12, exitDuration: 130 });
    const sendPop = usePop({ show: canPreviewSend, width: 56, gapBefore: ACTION_GAP, enterBounce: 12, exitDuration: 130 });
    const shutterTint = previewPeer ? 'transparent' : isDark ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.20)';
    const shutterFrame = {
        width: SHUTTER_SIZE,
        height: SHUTTER_SIZE,
        borderRadius: SHUTTER_SIZE / 2,
        overflow: 'hidden',
    };

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
            <GestureDetector gesture={touchGesture}>
                <View style={StyleSheet.absoluteFill}>
                    <VCamera
                        ref={cameraRef}
                        style={StyleSheet.absoluteFill}
                        device={device}
                        isActive={active}
                        outputs={cameraOutputs}
                        resizeMode="cover"
                        onPreviewStarted={resetZoom}
                        enableNativeZoomGesture
                    />
                </View>
            </GestureDetector>
            <GlassHeader style={{ height: insets.top }} pointerEvents="none" />
            {stagedPhoto ? (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }]} pointerEvents="box-none">
                    <Image source={{ uri: stagedPhoto.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    <View style={{ position: 'absolute', bottom: insets.bottom + 102, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: ACTION_GAP }}>
                        <GlassIcon glassEffectStyle="clear" icon={X} visible duration={PREVIEW_FADE} onPress={discardStaged} />
                        <GlassIcon glassEffectStyle="clear" icon={ArrowUpRight} iconSize={32} size={SHUTTER_SIZE} visible duration={PREVIEW_FADE} accent onPress={handleSendStaged} />
                        <GlassIcon glassEffectStyle="clear" icon={ArrowDownToLine} visible duration={PREVIEW_FADE} onPress={handleSaveStaged} />
                    </View>
                </View>
            ) : null}
            {!stagedPhoto ? (
                <View style={{ position: 'absolute', bottom: insets.bottom + 102, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <RNAnimated.View pointerEvents={chatPop.pointerEvents} style={[chatPop.style, { alignItems: 'center', justifyContent: 'center', overflow: 'visible' }]}>
                        <RNAnimated.View style={chatPop.childStyle}>
                            <GlassIcon glassEffectStyle="clear" icon={MessageCircle} onPress={() => canPreviewChat && handlePreviewChat()} />
                        </RNAnimated.View>
                    </RNAnimated.View>
                    <Pressable {...shutterFeedback.props} disabled={taking} onPress={handleShutterPress}>
                        <RNAnimated.View
                            style={{
                                ...shutterFrame,
                                transform: [{ scale: shutterFeedback.scale }],
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
                            </View>
                        </RNAnimated.View>
                    </Pressable>
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
