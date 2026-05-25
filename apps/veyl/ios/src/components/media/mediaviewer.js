import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated as RNAnimated, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRouter } from 'expo-router';
import { Check, Download, Play, Share2, Volume2, VolumeX } from 'lucide-react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useAudio } from '@/providers/audioprovider';
import { useTheme } from '@/providers/themeprovider';
import { alpha } from '@/lib/colors';
import { resolveMessageFileUri, saveMessageFile, saveMessageImage } from '@/lib/chatdownloads';
import { stageShareMedia } from '@/lib/sharemedia';
import { usePop } from '@/lib/pop';
import { useTap } from '@/lib/tap';
import { canShareAttachmentMsg, getImageAspect } from '@glyphteck/shared/chat/messages';
import Icon from '@/components/icon';

const DISMISS_DISTANCE = 240;
const DISMISS_VELOCITY = 1200;
const SWIPE_VELOCITY = 900;
const SWIPE_COMMIT_RATIO = 0.5;
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
const SCRUB_SEEK_TOLERANCE = { toleranceBefore: 0.08, toleranceAfter: 0.08 };
const EXACT_SEEK_TOLERANCE = { toleranceBefore: 0, toleranceAfter: 0 };
const SNAP_SPRING = {
    mass: 0.28,
    stiffness: 420,
    damping: 30,
};
const MEDIA_LOCK_MIN_MS = 80;
const MEDIA_LOCK_MAX_MS = 260;
const MEDIA_LOCK_DISTANCE_MS = 90;
const MUTE_FADE_OUT_DELAY_MS = 70;
const LINE_H = 6;
const SLIDER_SLOP = 32;
const SLIDE_GAP = 16;
const RENDER_RADIUS = 2;
const ACTION_ROW_H = 48;
const ACTION_ROW_GAP = 6;
const EXIT_MEDIA_RADIUS = 64;
const SWIPE_MEDIA_SCALE = 0.96;
const SWIPE_MEDIA_RADIUS = 24;
const SWIPE_MEDIA_DISTANCE = 18;
const LANDSCAPE_ASPECT_MIN = 1.1;

function clamp(value, min, max) {
    'worklet';
    return Math.max(min, Math.min(max, value));
}

function getMediaRect(stageW, stageH, aspect) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const widthByHeight = stageH * safeAspect;
    const heightByWidth = stageW / safeAspect;
    const width = widthByHeight <= stageW ? widthByHeight : stageW;
    const height = widthByHeight <= stageW ? stageH : heightByWidth;

    return {
        left: Math.round((stageW - width) / 2),
        top: Math.round((stageH - height) / 2),
        width: Math.round(width),
        height: Math.round(height),
        lineTop: Math.max(0, Math.round(height - LINE_H)),
    };
}

function getViewerLayout(screenW, screenH, aspect, orientation) {
    if (orientation === 'landscape') {
        const stageW = Math.max(screenW, screenH);
        const stageH = Math.min(screenW, screenH);

        return {
            landscape: true,
            rotate: '90deg',
            screenW,
            screenH,
            stageW,
            stageH,
            stageLeft: Math.round((screenW - stageW) / 2),
            stageTop: Math.round((screenH - stageH) / 2),
        };
    }

    return {
        landscape: false,
        rotate: '0deg',
        screenW,
        screenH,
        stageW: screenW,
        stageH: screenH,
        stageLeft: 0,
        stageTop: 0,
    };
}

function pointToStage(x, y, layout) {
    'worklet';
    if (!layout.landscape) {
        return { x, y };
    }

    const cx = layout.stageLeft + layout.stageW / 2;
    const cy = layout.stageTop + layout.stageH / 2;
    const dx = x - cx;
    const dy = y - cy;

    return {
        x: dy + layout.stageW / 2,
        y: -dx + layout.stageH / 2,
    };
}

function pointInMedia(point, rect) {
    'worklet';
    return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
}

function isSliderHit(point, rect) {
    'worklet';
    if (point.x < rect.left || point.x > rect.left + rect.width) {
        return false;
    }
    const y = point.y - rect.top;
    return y >= rect.lineTop - SLIDER_SLOP && y <= rect.lineTop + LINE_H + SLIDER_SLOP;
}

function sliderProgress(point, rect) {
    'worklet';
    return clamp((point.x - rect.left) / rect.width, 0, 1);
}

function getGesturePoint(event) {
    'worklet';
    const touch = event?.allTouches?.[0] || event?.changedTouches?.[0];
    return {
        x: touch?.x ?? event.x,
        y: touch?.y ?? event.y,
    };
}

function getMediaAspect(item) {
    const aspect = Number(item?.aspect);
    if (Number.isFinite(aspect) && aspect > 0) {
        return aspect;
    }
    return getImageAspect(item?.msg, item?.type === 'mp4' ? 16 / 9 : 4 / 3);
}

function getMediaOrientation(item, aspect) {
    if (Number.isFinite(aspect) && aspect > 0) {
        return aspect >= LANDSCAPE_ASPECT_MIN ? 'landscape' : 'portrait';
    }
    return item?.orientation === 'landscape' ? 'landscape' : 'portrait';
}

function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    if (minutes < 60) {
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    }
    const hours = Math.floor(minutes / 60);
    const hourMinutes = minutes % 60;
    return `${hours}:${String(hourMinutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function setPlayerProps(player, props) {
    try {
        Object.assign(player, props);
        return true;
    } catch (error) {
        console.warn('video player update failed', error);
        return false;
    }
}

function useResolvedMediaUri(item, label) {
    const [uri, setUri] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        setUri(null);
        setLoading(true);
        setError('');
        resolveMessageFileUri(item.msg, item.peerChatPK, item.readMessageFile)
            .then((nextUri) => {
                if (cancelled) {
                    return;
                }
                setUri(nextUri);
                setLoading(false);
            })
            .catch((nextError) => {
                if (cancelled) {
                    return;
                }
                console.warn(`chat ${label} viewer load failed`, nextError);
                setError(nextError?.message || `${label} unavailable`);
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [item.id, item.msg, item.peerChatPK, item.readMessageFile, label]);

    return { uri, loading, error, setError };
}

function ImageSlide({ active, item, onReady }) {
    const { theme } = useTheme();
    const { uri, loading, error, setError } = useResolvedMediaUri(item, 'image');

    if (uri && !error) {
        return (
            <Image
                source={{ uri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                enableLiveTextInteraction={false}
                onLoad={active ? onReady : undefined}
                onError={() => {
                    setError('image unavailable');
                    if (active) {
                        onReady?.();
                    }
                }}
            />
        );
    }

    return (
        <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            {loading ? <ActivityIndicator color={theme.foreground} /> : <Text style={{ color: theme.muted, fontSize: 14 }}>{error || 'image unavailable'}</Text>}
        </View>
    );
}

function VideoSlide({ active, item, rect, registerVideo, onReady, playAllowed, muted }) {
    const { theme } = useTheme();
    const { kind: activeAudioKind, key: activeAudioKey, play: playAudio, pause: pauseAudio, clear: clearAudio } = useAudio();
    const { uri, loading, error } = useResolvedMediaUri(item, 'video');
    const [dragPausing, setDragPausing] = useState(false);
    const [pausedByUser, setPausedByUser] = useState(false);
    const [playingIntent, setPlayingIntent] = useState(false);
    const [sliding, setSliding] = useState(false);
    const [slideTime, setSlideTime] = useState(null);
    const pausedByUserRef = useRef(false);
    const playingRef = useRef(false);
    const seekFrameRef = useRef(null);
    const seekProgressRef = useRef(null);
    const player = useVideoPlayer(uri ? { uri } : null, (nextPlayer) => {
        nextPlayer.loop = true;
        nextPlayer.timeUpdateEventInterval = 0.02;
        nextPlayer.audioMixingMode = 'mixWithOthers';
        nextPlayer.volume = 1;
        nextPlayer.muted = muted;
    });
    const timeUpdate = useEvent(player, 'timeUpdate', { currentTime: 0, bufferedPosition: 0, currentLiveTimestamp: null, currentOffsetFromLive: null });
    const playingChange = useEvent(player, 'playingChange', { isPlaying: !!player.playing });
    const sourceLoad = useEvent(player, 'sourceLoad', {
        duration: Number.isFinite(item?.msg?.d) ? item.msg.d : 0,
        videoSource: null,
        availableSubtitleTracks: [],
        availableAudioTracks: [],
        videoTrack: null,
    });
    const statusChange = useEvent(player, 'statusChange', { status: player.status });
    const duration =
        Number.isFinite(sourceLoad?.duration) && sourceLoad.duration > 0 ? sourceLoad.duration : Number.isFinite(player.duration) ? player.duration : Number.isFinite(item?.msg?.d) ? item.msg.d : 0;
    const currentTime = Number.isFinite(timeUpdate?.currentTime) ? timeUpdate.currentTime : Number.isFinite(player.currentTime) ? player.currentTime : 0;
    const nativePlaying = !!(playingChange?.isPlaying || player.playing);
    const audioOwnsPlayback = activeAudioKind === 'video' && activeAudioKey === item.id;
    const playing = playingIntent || audioOwnsPlayback || (!pausedByUser && nativePlaying);
    const shownTime = sliding && slideTime != null ? slideTime : currentTime;
    const progress = duration > 0 ? clamp(shownTime / duration, 0, 1) : 0;
    const busy = loading || statusChange?.status === 'loading';
    const disabled = loading || !!error || !uri || statusChange?.status === 'error';
    const showPlay = !disabled && !playing;

    const queueSeek = useCallback(
        (nextProgress) => {
            if (!duration) {
                return;
            }

            seekProgressRef.current = Math.max(0, Math.min(1, nextProgress));
            if (seekFrameRef.current) {
                return;
            }
            seekFrameRef.current = requestAnimationFrame(() => {
                seekFrameRef.current = null;
                const queued = seekProgressRef.current;
                seekProgressRef.current = null;
                if (queued == null) {
                    return;
                }
                const nextTime = queued * duration;
                setSlideTime(nextTime);
                setPlayerProps(player, { currentTime: nextTime });
            });
        },
        [duration, player]
    );

    const setScrubbing = useCallback(
        (nextSliding) => {
            setSliding(nextSliding);
            if (!nextSliding) {
                setSlideTime(null);
            }
            setPlayerProps(player, {
                scrubbingModeOptions: { scrubbingModeEnabled: nextSliding },
                seekTolerance: nextSliding ? SCRUB_SEEK_TOLERANCE : EXACT_SEEK_TOLERANCE,
            });
        },
        [player]
    );

    const startPlayback = useCallback(() => {
        if (!active || !uri || error) {
            return;
        }
        try {
            pausedByUserRef.current = false;
            playingRef.current = true;
            setDragPausing(false);
            setPausedByUser(false);
            setPlayingIntent(true);
            setPlayerProps(player, {
                loop: true,
                seekTolerance: EXACT_SEEK_TOLERANCE,
                scrubbingModeOptions: { scrubbingModeEnabled: false },
                muted,
                volume: 1,
            });
            playAudio({ kind: 'video', key: item.id, player });
        } catch (nextError) {
            console.warn('video play failed', nextError);
        }
    }, [active, error, item.id, muted, playAudio, player, uri]);

    const pausePlayback = useCallback(
        (byUser = true) => {
            if (byUser) {
                pausedByUserRef.current = true;
                setPausedByUser(true);
            }
            playingRef.current = false;
            setPlayingIntent(false);
            pauseAudio({ kind: 'video', key: item.id, player });
            clearAudio({ kind: 'video', key: item.id, player });
        },
        [clearAudio, item.id, pauseAudio, player]
    );

    const togglePlayback = useCallback(() => {
        if (disabled || !playAllowed) {
            return;
        }
        if (pausedByUserRef.current || pausedByUser) {
            startPlayback();
            return;
        }
        if (playingRef.current || audioOwnsPlayback || nativePlaying) {
            pausePlayback(true);
            return;
        }
        startPlayback();
    }, [audioOwnsPlayback, disabled, nativePlaying, pausePlayback, pausedByUser, playAllowed, startPlayback]);

    const pauseForDrag = useCallback(() => {
        setDragPausing(true);
        pausePlayback(false);
    }, [pausePlayback]);

    const cancelDrag = useCallback(() => {
        setDragPausing(false);
    }, []);

    const startScrub = useCallback(
        (nextProgress) => {
            setScrubbing(true);
            queueSeek(nextProgress);
        },
        [queueSeek, setScrubbing]
    );

    const moveScrub = useCallback(
        (nextProgress) => {
            queueSeek(nextProgress);
        },
        [queueSeek]
    );

    const endScrub = useCallback(() => {
        setScrubbing(false);
    }, [setScrubbing]);

    const tap = useCallback(
        (event, layout) => {
            const point = pointToStage(event.x, event.y, layout);
            if (!disabled && duration > 0 && isSliderHit(point, rect)) {
                queueSeek(sliderProgress(point, rect));
                return;
            }
            if (!disabled && pointInMedia(point, rect)) {
                togglePlayback();
            }
        },
        [disabled, duration, queueSeek, rect, togglePlayback]
    );

    useEffect(() => {
        if (!active) {
            pausedByUserRef.current = false;
            playingRef.current = false;
            pausePlayback(false);
            setDragPausing(false);
            setPausedByUser(false);
            setPlayingIntent(false);
            setScrubbing(false);
        }
    }, [active, pausePlayback, setScrubbing]);

    useEffect(() => {
        if (!active && uri) {
            pausePlayback(false);
        }
    }, [active, pausePlayback, uri]);

    useEffect(() => {
        if (!playingIntent || !activeAudioKind || audioOwnsPlayback) {
            return;
        }
        playingRef.current = false;
        setPlayingIntent(false);
    }, [activeAudioKind, audioOwnsPlayback, playingIntent]);

    useEffect(() => {
        if (active && !playAllowed) {
            pausePlayback(false);
        }
    }, [active, pausePlayback, playAllowed]);

    useEffect(() => {
        setPlayerProps(player, { muted });
    }, [muted, player]);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        return registerVideo({
            startScrub,
            moveScrub,
            endScrub,
            pauseForDrag,
            cancelDrag,
            tap,
        });
    }, [active, cancelDrag, endScrub, moveScrub, pauseForDrag, registerVideo, startScrub, tap]);

    useEffect(
        () => () => {
            if (seekFrameRef.current) {
                cancelAnimationFrame(seekFrameRef.current);
                seekFrameRef.current = null;
            }
            clearAudio({ kind: 'video', key: item.id, player });
        },
        [clearAudio, item.id, player]
    );

    return (
        <>
            {uri && !error ? (
                <VideoView
                    player={player}
                    pointerEvents="none"
                    nativeControls={false}
                    contentFit="contain"
                    fullscreenOptions={{ enable: false }}
                    allowsVideoFrameAnalysis={false}
                    onFirstFrameRender={active ? onReady : undefined}
                    style={{ width: '100%', height: '100%' }}
                />
            ) : (
                <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                    {loading ? <ActivityIndicator color={theme.foreground} /> : <Text style={{ color: theme.muted, fontSize: 14 }}>{error || 'video unavailable'}</Text>}
                </View>
            )}
            {busy && uri && !error ? (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator color={theme.foreground} />
                </View>
            ) : null}
            {showPlay ? (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon icon={Play} color="#fff" size={54} fill="#fff" strokeWidth={0} />
                </View>
            ) : null}
            {active && sliding ? (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: LINE_H + 10, alignItems: 'center' }}>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: alpha(theme.background, 78) }}>
                        <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                            {formatTime(shownTime)} / {formatTime(duration)}
                        </Text>
                    </View>
                </View>
            ) : null}
            {uri && !error ? (
                <View
                    pointerEvents="none"
                    style={{ position: 'absolute', left: 0, top: rect.lineTop, width: '100%', height: LINE_H, backgroundColor: alpha(theme.foreground, 22), overflow: 'hidden' }}
                >
                    <View style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: theme.foreground }} />
                </View>
            ) : null}
        </>
    );
}

function MediaSlide({ active, item, screenW, screenH, mediaStyle, swipeStyle, registerVideo, onReady, playAllowed, muted }) {
    const aspect = getMediaAspect(item);
    const layout = useMemo(() => getViewerLayout(screenW, screenH, aspect, getMediaOrientation(item, aspect)), [aspect, item, screenH, screenW]);
    const rect = getMediaRect(layout.stageW, layout.stageH, aspect);

    return (
        <View
            style={{
                position: 'absolute',
                left: layout.stageLeft,
                top: layout.stageTop,
                width: layout.stageW,
                height: layout.stageH,
                transform: [{ rotate: layout.rotate }],
            }}
        >
            <Animated.View
                style={[
                    {
                        position: 'absolute',
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                    },
                    swipeStyle,
                ]}
            >
                <Animated.View style={[{ width: '100%', height: '100%' }, active ? mediaStyle : null]}>
                    {item.type === 'mp4' ? (
                        <VideoSlide active={active} item={item} rect={rect} registerVideo={registerVideo} onReady={onReady} playAllowed={playAllowed} muted={muted} />
                    ) : (
                        <ImageSlide active={active} item={item} onReady={onReady} />
                    )}
                </Animated.View>
            </Animated.View>
        </View>
    );
}

function ActionIconButton({ children, disabled = false, onPress }) {
    const tap = useTap({ disabled, onPress, hapticOut: 'soft' });

    return (
        <Pressable {...tap.props} disabled={disabled} hitSlop={12}>
            <RNAnimated.View
                style={{
                    width: ACTION_ROW_H,
                    height: ACTION_ROW_H,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ scale: tap.scale }],
                }}
            >
                {children}
            </RNAnimated.View>
        </Pressable>
    );
}

export function FullscreenRail({ activeIndex, items, onCloseComplete, onMove }) {
    const { theme } = useTheme();
    const router = useRouter();
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
    const visibleItems = useMemo(() => items.map((item, index) => ({ item, index })).filter(({ index }) => Math.abs(index - activeIndex) <= RENDER_RADIUS), [activeIndex, items]);
    const openScale = useSharedValue(0.01);
    const backdropOpacity = useSharedValue(0);
    const mediaOpacity = useSharedValue(0);
    const mediaRadius = useSharedValue(0);
    const swipeProgress = useSharedValue(0);
    const saveOpacity = useSharedValue(1);
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
    const [saving, setSaving] = useState(false);
    const [savedId, setSavedId] = useState(null);
    const [muted, setMuted] = useState(false);
    const mutePop = usePop({ show: activeIsVideo, from: 0.58, enterBounce: 16, exitDuration: MEDIA_OUT_MS });
    const canPrevious = activeIndex > 0;
    const canNext = activeIndex >= 0 && activeIndex < items.length - 1;
    const saved = !!activeItem && savedId === activeItem.id;
    const saveDisabled = saving || saved || !activeItem;

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
    const saveStyle = useAnimatedStyle(() => ({
        opacity: saveOpacity.value,
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
        saveOpacity.value = withTiming(0, MEDIA_OUT_TIMING);
        muteOpacity.value = withTiming(0, MEDIA_OUT_TIMING);
        openScale.value = withTiming(0.01, MEDIA_OUT_TIMING);
        setTimeout(() => {
            activeVideoRef.current?.pauseForDrag?.();
        }, 0);
        closeTimerRef.current = setTimeout(() => {
            onCloseComplete();
            afterClose?.();
        }, CLOSE_UNMOUNT_MS);
    }, [backdropOpacity, mediaOpacity, mediaRadius, muteOpacity, onCloseComplete, openScale, saveOpacity, swipeProgress]);

    useEffect(() => {
        openScale.value = 0.01;
        backdropOpacity.value = 0;
        mediaOpacity.value = 0;
        mediaRadius.value = 0;
        swipeProgress.value = 0;
        saveOpacity.value = 1;
        mediaShownRef.current = false;
        closingRef.current = false;
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
    }, [backdropOpacity, mediaOpacity, mediaRadius, openScale, saveOpacity, showMedia, swipeProgress]);

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
        setSavedId(null);
        mediaRadius.value = 0;
        swipeProgress.value = withTiming(0, MEDIA_OUT_TIMING);
        saveOpacity.value = 1;
    }, [activeIndex, mediaRadius, panStartX, railX, saveOpacity, slideW, swipeProgress]);

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
    const saveActiveMedia = useCallback(async () => {
        if (saveDisabled || !activeItem) {
            return;
        }

        setSaving(true);
        try {
            if (activeItem.type === 'img') {
                await saveMessageImage(activeItem.msg, activeItem.peerChatPK, activeItem.readMessageFile);
            } else {
                await saveMessageFile(activeItem.msg, activeItem.peerChatPK, activeItem.readMessageFile);
            }
            setSavedId(activeItem.id);
        } catch (error) {
            console.warn('viewer media save failed', error);
        } finally {
            setSaving(false);
        }
    }, [activeItem, saveDisabled]);
    const shareActiveMedia = useCallback(() => {
        if (!activeItem?.msg || !canShareAttachmentMsg(activeItem.msg)) {
            return;
        }
        const params = stageShareMedia(activeItem.msg);
        if (!params) {
            return;
        }
        router.push({ pathname: '/sharemedia', params });
    }, [activeItem, router]);
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
                .onBegin((event) => {
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
                        saveOpacity.value = 1 - progress;
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
                        saveOpacity.value = withTiming(1, MEDIA_OUT_TIMING);
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
                        saveOpacity.value = withTiming(1, MEDIA_OUT_TIMING);
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
            canNext,
            canPrevious,
            close,
            endScrub,
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
            saveOpacity,
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

    const shareDisabled = !canShareAttachmentMsg(activeItem.msg);

    return (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 100 }}>
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, backdropStyle]}>
                <BlurView tint="default" intensity={88} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
                <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: alpha(theme.background, 22) }} />
            </Animated.View>
            <View style={{ flex: 1, paddingTop: topPad, paddingBottom: bottomPad }}>
                <GestureDetector gesture={mediaGesture}>
                    <View style={{ width: screenW, height: mediaH, overflow: 'visible' }}>
                        <Animated.View style={[{ width: screenW, height: mediaH, overflow: 'visible' }, railStyle]}>
                            {visibleItems.map(({ item, index }) => (
                                <View
                                    key={item.id}
                                    style={{
                                        position: 'absolute',
                                        left: index * slideW,
                                        top: 0,
                                        width: screenW,
                                        height: mediaH,
                                        overflow: 'visible',
                                    }}
                                >
                                    <MediaSlide
                                        active={index === activeIndex}
                                        item={item}
                                        screenW={screenW}
                                        screenH={mediaH}
                                        mediaStyle={activeMediaStyle}
                                        swipeStyle={swipeMediaStyle}
                                        registerVideo={registerVideo}
                                        onReady={showMedia}
                                        playAllowed={shown}
                                        muted={muted}
                                    />
                                </View>
                            ))}
                        </Animated.View>
                    </View>
                </GestureDetector>
                <View
                    style={{
                        height: ACTION_ROW_H,
                        marginTop: ACTION_ROW_GAP,
                        paddingHorizontal: 18,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                    }}
                >
                    <Animated.View pointerEvents={mutePop.pointerEvents} style={muteStyle}>
                        <RNAnimated.View style={mutePop.childStyle}>
                            <ActionIconButton onPress={toggleMuted} disabled={!activeIsVideo}>
                                <Icon icon={muted ? VolumeX : Volume2} size={24} color={theme.foreground} />
                            </ActionIconButton>
                        </RNAnimated.View>
                    </Animated.View>
                    <Animated.View style={saveStyle}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ACTION_ROW_GAP }}>
                            <ActionIconButton onPress={shareActiveMedia} disabled={shareDisabled}>
                                <Icon icon={Share2} size={24} color={theme.foreground} />
                            </ActionIconButton>
                            <ActionIconButton onPress={saveActiveMedia} disabled={saveDisabled}>
                                {saving ? <ActivityIndicator color={theme.foreground} /> : <Icon icon={saved ? Check : Download} size={24} color={theme.foreground} />}
                            </ActionIconButton>
                        </View>
                    </Animated.View>
                </View>
            </View>
        </View>
    );
}
