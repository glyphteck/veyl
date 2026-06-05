import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '@/providers/themeprovider';
import { alpha } from '@/lib/colors';
import {
    clamp,
    getGesturePoint,
    getMediaAspect,
    getMediaOrientation,
    getMediaRect,
    getViewerLayout,
    isSliderHit,
    pointToStage,
    sliderProgress,
} from '@/lib/media/mediaviewer';
import { ACTION_ROW_GAP, ACTION_ROW_H, ViewerMenu } from './mediaviewer/menu';
import { MediaSlider } from './mediaviewer/slider';

const DISMISS_DISTANCE = 240;
const DISMISS_VELOCITY = 1200;
const SWIPE_VELOCITY = 900;
const PAN_MIN_DISTANCE = 2;
const PAN_AXIS_LOCK = 2;
const PAN_AXIS_RATIO = 1.15;
const PAN_NONE = 0;
const PAN_SCRUB = 1;
const PAN_EXIT = 2;
const PAN_SWIPE = 3;
const MEDIA_IN_MS = 240;
const MEDIA_OUT_MS = 160;
const BACKDROP_IN_MS = 160;
const BACKDROP_OUT_MS = 240;
const CLOSE_UNMOUNT_MS = Math.max(MEDIA_OUT_MS, BACKDROP_OUT_MS);
const FIRST_FRAME_FALLBACK_MS = 180;
const MEDIA_IN_TIMING = { duration: MEDIA_IN_MS, easing: Easing.out(Easing.cubic) };
const MEDIA_OUT_TIMING = { duration: MEDIA_OUT_MS, easing: Easing.out(Easing.cubic) };
const BACKDROP_IN_TIMING = { duration: BACKDROP_IN_MS, easing: Easing.out(Easing.cubic) };
const BACKDROP_OUT_TIMING = { duration: BACKDROP_OUT_MS, easing: Easing.out(Easing.cubic) };
const SNAP_SPRING = {
    mass: 0.28,
    stiffness: 420,
    damping: 30,
};
const MEDIA_LOCK_MIN_MS = 80;
const MEDIA_LOCK_MAX_MS = 260;
const MEDIA_LOCK_DISTANCE_MS = 90;
const MUTE_FADE_OUT_DELAY_MS = 70;
const SLIDE_GAP = 16;
const EXIT_MEDIA_RADIUS = 64;
const SWIPE_MEDIA_SCALE = 0.96;
const SWIPE_MEDIA_RADIUS = 24;
const SWIPE_MEDIA_DISTANCE = 18;

export function FullscreenRail({ activeIndex, items, onCloseComplete, onCloseStart, onMove }) {
    const { theme } = useTheme();
    const { width: screenW, height: screenH } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const activeItem = items[activeIndex] || null;
    const activeIsVideo = activeItem?.type === 'mp4';
    const activeAspect = getMediaAspect(activeItem);
    const topPad = Math.max(0, insets.top);
    const bottomPad = Math.max(0, insets.bottom);
    const mediaH = Math.max(1, screenH - topPad - bottomPad - ACTION_ROW_GAP - ACTION_ROW_H);
    const activeMediaLayout = useMemo(() => getViewerLayout(screenW, mediaH, activeAspect, getMediaOrientation(activeItem, activeAspect)), [activeAspect, activeItem, mediaH, screenW]);
    const activeRect = getMediaRect(activeMediaLayout.stageW, activeMediaLayout.stageH, activeAspect);
    const slideW = screenW + SLIDE_GAP;
    const openScale = useSharedValue(0.01);
    const backdropOpacity = useSharedValue(0);
    const mediaOpacity = useSharedValue(0);
    const mediaRadius = useSharedValue(0);
    const swipeProgress = useSharedValue(0);
    const downloadOpacity = useSharedValue(1);
    const muteOpacity = useSharedValue(activeIsVideo ? 1 : 0);
    const railX = useSharedValue(-activeIndex * slideW);
    const panStartX = useSharedValue(-activeIndex * slideW);
    const panMode = useSharedValue(PAN_NONE);
    const panDidEnd = useSharedValue(false);
    const panStartedOnSlider = useSharedValue(false);
    const activeVideoRef = useRef(null);
    const closingRef = useRef(false);
    const closeTimerRef = useRef(null);
    const firstFrameTimerRef = useRef(null);
    const shownTimerRef = useRef(null);
    const mediaShownRef = useRef(false);
    const pendingRailTargetRef = useRef(null);
    const [shown, setShown] = useState(false);
    const [closing, setClosing] = useState(false);
    const [muted, setMuted] = useState(false);
    const canPrevious = activeIndex > 0;
    const canNext = activeIndex >= 0 && activeIndex < items.length - 1;

    const activeMediaStyle = useAnimatedStyle(
        () => ({
            transform: [{ scale: openScale.value }],
            opacity: mediaOpacity.value,
            borderRadius: mediaRadius.value,
            overflow: 'hidden',
        }),
        []
    );
    const swipeMediaStyle = useAnimatedStyle(
        () => ({
            transform: [{ scale: 1 - swipeProgress.value * (1 - SWIPE_MEDIA_SCALE) }],
            borderRadius: swipeProgress.value * SWIPE_MEDIA_RADIUS,
            overflow: 'hidden',
        }),
        []
    );
    const railStyle = useAnimatedStyle(
        () => ({
            transform: [{ translateX: railX.value }],
        }),
        []
    );
    const backdropStyle = useAnimatedStyle(() => ({
        opacity: backdropOpacity.value,
    }));
    const downloadStyle = useAnimatedStyle(() => ({
        opacity: downloadOpacity.value,
    }));
    const muteStyle = useAnimatedStyle(() => ({
        opacity: muteOpacity.value,
    }));

    const registerVideo = useCallback((api) => {
        activeVideoRef.current = api;
        return () => {
            if (activeVideoRef.current === api) {
                activeVideoRef.current = null;
            }
        };
    }, []);

    const showMedia = useCallback(() => {
        if (closingRef.current || mediaShownRef.current) {
            return;
        }
        mediaShownRef.current = true;
        if (firstFrameTimerRef.current) {
            clearTimeout(firstFrameTimerRef.current);
            firstFrameTimerRef.current = null;
        }
        mediaOpacity.value = withTiming(1, MEDIA_IN_TIMING);
        openScale.value = withTiming(1, MEDIA_IN_TIMING);
        shownTimerRef.current = setTimeout(() => {
            setShown(true);
            shownTimerRef.current = null;
        }, MEDIA_IN_MS);
    }, [mediaOpacity, openScale]);

    const close = useCallback((afterClose) => {
        if (closingRef.current) {
            return;
        }
        closingRef.current = true;
        setClosing(true);
        onCloseStart?.();
        if (firstFrameTimerRef.current) {
            clearTimeout(firstFrameTimerRef.current);
            firstFrameTimerRef.current = null;
        }
        if (shownTimerRef.current) {
            clearTimeout(shownTimerRef.current);
            shownTimerRef.current = null;
        }

        backdropOpacity.value = withTiming(0, BACKDROP_OUT_TIMING);
        mediaOpacity.value = withTiming(0, MEDIA_OUT_TIMING);
        mediaRadius.value = withTiming(EXIT_MEDIA_RADIUS, MEDIA_OUT_TIMING);
        swipeProgress.value = withTiming(0, MEDIA_OUT_TIMING);
        downloadOpacity.value = withTiming(0, MEDIA_OUT_TIMING);
        muteOpacity.value = withTiming(0, MEDIA_OUT_TIMING);
        openScale.value = withTiming(0.01, MEDIA_OUT_TIMING);
        setTimeout(() => {
            activeVideoRef.current?.pauseForDrag?.();
        }, 0);
        closeTimerRef.current = setTimeout(() => {
            onCloseComplete();
            afterClose?.();
        }, CLOSE_UNMOUNT_MS);
    }, [backdropOpacity, downloadOpacity, mediaOpacity, mediaRadius, muteOpacity, onCloseComplete, onCloseStart, openScale, swipeProgress]);

    useEffect(() => {
        openScale.value = 0.01;
        backdropOpacity.value = 0;
        mediaOpacity.value = 0;
        mediaRadius.value = 0;
        swipeProgress.value = 0;
        downloadOpacity.value = 1;
        mediaShownRef.current = false;
        closingRef.current = false;
        setClosing(false);
        setShown(false);
        backdropOpacity.value = withTiming(1, BACKDROP_IN_TIMING);
        firstFrameTimerRef.current = setTimeout(showMedia, FIRST_FRAME_FALLBACK_MS);

        return () => {
            if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }
            if (firstFrameTimerRef.current) {
                clearTimeout(firstFrameTimerRef.current);
                firstFrameTimerRef.current = null;
            }
            if (shownTimerRef.current) {
                clearTimeout(shownTimerRef.current);
                shownTimerRef.current = null;
            }
        };
    }, [backdropOpacity, downloadOpacity, mediaOpacity, mediaRadius, openScale, showMedia, swipeProgress]);

    useEffect(() => {
        const target = -activeIndex * slideW;
        const pendingTarget = pendingRailTargetRef.current;
        pendingRailTargetRef.current = null;

        if (pendingTarget != null && Math.abs(pendingTarget - target) <= 0.5) {
            panStartX.value = target;
        } else {
            cancelAnimation(railX);
            railX.value = target;
            panStartX.value = target;
        }
        mediaRadius.value = 0;
        swipeProgress.value = withTiming(0, MEDIA_OUT_TIMING);
        downloadOpacity.value = 1;
    }, [activeIndex, downloadOpacity, mediaRadius, panStartX, railX, slideW, swipeProgress]);

    useEffect(() => {
        if (activeIsVideo) {
            muteOpacity.value = withTiming(1, MEDIA_OUT_TIMING);
        } else {
            muteOpacity.value = withDelay(
                MUTE_FADE_OUT_DELAY_MS,
                withTiming(0, {
                    duration: Math.max(1, MEDIA_OUT_MS - MUTE_FADE_OUT_DELAY_MS),
                    easing: Easing.out(Easing.cubic),
                })
            );
        }
    }, [activeIsVideo, muteOpacity]);

    const startScrub = useCallback((progress) => activeVideoRef.current?.startScrub?.(progress), []);
    const moveScrub = useCallback((progress) => activeVideoRef.current?.moveScrub?.(progress), []);
    const endScrub = useCallback(() => activeVideoRef.current?.endScrub?.(), []);
    const pauseActiveVideoForGesture = useCallback(() => {
        activeVideoRef.current?.pauseForDrag?.();
    }, []);
    const navigate = useCallback(
        (step, railTarget) => {
            if (Number.isFinite(railTarget)) {
                pendingRailTargetRef.current = railTarget;
            }
            onMove(step);
        },
        [onMove]
    );
    const toggleMuted = useCallback(() => {
        setMuted((current) => !current);
    }, []);

    const mediaPan = useMemo(
        () =>
            Gesture.Pan()
                .minDistance(PAN_MIN_DISTANCE)
                .onTouchesDown((event) => {
                    'worklet';
                    const touch = getGesturePoint(event);
                    const point = pointToStage(touch.x, touch.y, activeMediaLayout);
                    panStartedOnSlider.value = activeIsVideo && isSliderHit(point, activeRect);
                })
                .onBegin(() => {
                    'worklet';
                    cancelAnimation(railX);
                    panStartX.value = railX.value;
                    panDidEnd.value = false;
                    panMode.value = PAN_NONE;
                })
                .onUpdate((event) => {
                    'worklet';
                    if (panMode.value === PAN_SCRUB) {
                        const point = pointToStage(event.x, event.y, activeMediaLayout);
                        scheduleOnRN(moveScrub, sliderProgress(point, activeRect));
                        return;
                    }

                    if (panMode.value === PAN_NONE) {
                        if (panStartedOnSlider.value) {
                            const point = pointToStage(event.x, event.y, activeMediaLayout);
                            panMode.value = PAN_SCRUB;
                            scheduleOnRN(pauseActiveVideoForGesture);
                            scheduleOnRN(startScrub, sliderProgress(point, activeRect));
                            return;
                        }

                        const ax = Math.abs(event.translationX);
                        const ay = Math.abs(event.translationY);
                        if (ax > ay) {
                            swipeProgress.value = clamp(ax / SWIPE_MEDIA_DISTANCE, 0, 1);
                        }
                        if (ax < PAN_AXIS_LOCK && ay < PAN_AXIS_LOCK) {
                            return;
                        }
                        if (ax > ay * PAN_AXIS_RATIO) {
                            panMode.value = PAN_SWIPE;
                            if (activeIsVideo) {
                                scheduleOnRN(pauseActiveVideoForGesture);
                            }
                            swipeProgress.value = clamp(ax / SWIPE_MEDIA_DISTANCE, 0, 1);
                        } else if (ay > ax * PAN_AXIS_RATIO) {
                            panMode.value = PAN_EXIT;
                            if (activeIsVideo) {
                                scheduleOnRN(pauseActiveVideoForGesture);
                            }
                            swipeProgress.value = withTiming(0, MEDIA_OUT_TIMING);
                        } else {
                            return;
                        }
                    }

                    if (panMode.value === PAN_SWIPE) {
                        const step = event.translationX < 0 ? 1 : -1;
                        const hasTarget = step < 0 ? canPrevious : canNext;
                        railX.value = panStartX.value + (hasTarget ? event.translationX : event.translationX * 0.28);
                        swipeProgress.value = clamp(Math.abs(event.translationX) / SWIPE_MEDIA_DISTANCE, 0, 1);
                        return;
                    }

                    if (panMode.value === PAN_EXIT) {
                        const progress = clamp(Math.abs(event.translationY) / DISMISS_DISTANCE, 0, 1);
                        openScale.value = 1 - progress * 0.45;
                        mediaOpacity.value = 1 - progress * 0.45;
                        mediaRadius.value = EXIT_MEDIA_RADIUS * progress;
                        downloadOpacity.value = 1 - progress;
                    }
                })
                .onEnd((event) => {
                    'worklet';
                    panDidEnd.value = true;
                    if (panMode.value === PAN_SCRUB) {
                        panMode.value = PAN_NONE;
                        scheduleOnRN(endScrub);
                        return;
                    }

                    if (panMode.value === PAN_NONE) {
                        return;
                    }

                    if (panMode.value === PAN_SWIPE) {
                        const currentIndex = clamp(Math.round(-railX.value / slideW), 0, items.length - 1);
                        const mostVisibleStep = currentIndex - activeIndex;
                        const velocityStep = Math.abs(event.velocityX) > SWIPE_VELOCITY ? (event.velocityX < 0 ? 1 : -1) : 0;
                        const step = velocityStep || mostVisibleStep;
                        const hasTarget = step === 0 || (step < 0 ? canPrevious : canNext);
                        const shouldMove = hasTarget && step !== 0;
                        panMode.value = PAN_NONE;
                        swipeProgress.value = withTiming(0, MEDIA_OUT_TIMING);
                        if (shouldMove) {
                            const target = -(activeIndex + step) * slideW;
                            const remaining = Math.abs(target - railX.value);
                            railX.value = withTiming(target, {
                                duration: clamp(MEDIA_LOCK_MIN_MS + (remaining / slideW) * MEDIA_LOCK_DISTANCE_MS, MEDIA_LOCK_MIN_MS, MEDIA_LOCK_MAX_MS),
                                easing: Easing.out(Easing.cubic),
                            });
                            scheduleOnRN(navigate, step, target);
                            return;
                        }
                        const target = -activeIndex * slideW;
                        const remaining = Math.abs(target - railX.value);
                        railX.value = withTiming(target, {
                            duration: clamp(MEDIA_LOCK_MIN_MS + (remaining / slideW) * MEDIA_LOCK_DISTANCE_MS, MEDIA_LOCK_MIN_MS, MEDIA_LOCK_MAX_MS),
                            easing: Easing.out(Easing.cubic),
                        });
                        return;
                    }

                    if (panMode.value === PAN_EXIT) {
                        panMode.value = PAN_NONE;
                        if (Math.abs(event.translationY) > DISMISS_DISTANCE || Math.abs(event.velocityY) > DISMISS_VELOCITY) {
                            scheduleOnRN(close);
                            return;
                        }
                        openScale.value = withSpring(1, SNAP_SPRING);
                        mediaOpacity.value = withTiming(1, MEDIA_OUT_TIMING);
                        mediaRadius.value = withTiming(0, MEDIA_OUT_TIMING);
                        downloadOpacity.value = withTiming(1, MEDIA_OUT_TIMING);
                    }
                })
                .onFinalize(() => {
                    'worklet';
                    if (panDidEnd.value) {
                        panDidEnd.value = false;
                        panMode.value = PAN_NONE;
                        panStartedOnSlider.value = false;
                        return;
                    }

                    if (panMode.value === PAN_SCRUB) {
                        scheduleOnRN(endScrub);
                    } else if (panMode.value === PAN_EXIT) {
                        openScale.value = withSpring(1, SNAP_SPRING);
                        mediaOpacity.value = withTiming(1, MEDIA_OUT_TIMING);
                        mediaRadius.value = withTiming(0, MEDIA_OUT_TIMING);
                        downloadOpacity.value = withTiming(1, MEDIA_OUT_TIMING);
                    } else if (panMode.value === PAN_SWIPE) {
                        railX.value = withTiming(-activeIndex * slideW, MEDIA_OUT_TIMING);
                        swipeProgress.value = withTiming(0, MEDIA_OUT_TIMING);
                    }
                    panMode.value = PAN_NONE;
                    panStartedOnSlider.value = false;
                }),
        [
            activeIsVideo,
            activeMediaLayout,
            activeRect,
            activeIndex,
            canNext,
            canPrevious,
            close,
            endScrub,
            items.length,
            mediaOpacity,
            mediaRadius,
            moveScrub,
            navigate,
            openScale,
            panDidEnd,
            panMode,
            pauseActiveVideoForGesture,
            panStartX,
            panStartedOnSlider,
            railX,
            downloadOpacity,
            slideW,
            startScrub,
            swipeProgress,
        ]
    );

    const handleTap = useCallback(
        (event) => {
            activeVideoRef.current?.tap?.(event, activeMediaLayout);
        },
        [activeMediaLayout]
    );

    const tapGesture = useMemo(
        () =>
            Gesture.Tap()
                .maxDuration(260)
                .maxDistance(10)
                .runOnJS(true)
                .onEnd((event, success) => {
                    if (success) {
                        handleTap(event);
                    }
                }),
        [handleTap]
    );
    const mediaGesture = useMemo(() => Gesture.Exclusive(mediaPan, tapGesture), [mediaPan, tapGesture]);

    if (!activeItem) {
        return null;
    }

    return (
        <View pointerEvents={closing ? 'none' : 'auto'} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 100 }}>
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, backdropStyle]}>
                <BlurView tint="default" intensity={88} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
                <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: alpha(theme.background, 22) }} />
            </Animated.View>
            <View style={{ flex: 1, paddingTop: topPad, paddingBottom: bottomPad }}>
                <MediaSlider
                    activeIndex={activeIndex}
                    gesture={mediaGesture}
                    items={items}
                    mediaH={mediaH}
                    mediaStyle={activeMediaStyle}
                    muted={muted}
                    onReady={showMedia}
                    playAllowed={shown}
                    railStyle={railStyle}
                    registerVideo={registerVideo}
                    screenW={screenW}
                    slideW={slideW}
                    swipeStyle={swipeMediaStyle}
                />
                <ViewerMenu
                    activeIsVideo={activeIsVideo}
                    activeItem={activeItem}
                    muted={muted}
                    muteStyle={muteStyle}
                    onToggleMuted={toggleMuted}
                    downloadStyle={downloadStyle}
                    theme={theme}
                />
            </View>
        </View>
    );
}
