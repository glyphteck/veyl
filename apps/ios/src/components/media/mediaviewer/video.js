import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Play } from 'lucide-react-native';
import { useAudio } from '@/providers/audioprovider';
import { useTheme } from '@/providers/themeprovider';
import { alpha } from '@/lib/colors';
import { formatDuration } from '@veyl/shared/utils/time';
import Icon from '@/components/icon';
import { clamp, isSliderHit, LINE_H, pointInMedia, pointToStage, sliderProgress } from '@/lib/media/mediaviewer';

const SCRUB_SEEK_TOLERANCE = { toleranceBefore: 0.08, toleranceAfter: 0.08 };
const EXACT_SEEK_TOLERANCE = { toleranceBefore: 0, toleranceAfter: 0 };

function setPlayerProps(player, props) {
    try {
        Object.assign(player, props);
        return true;
    } catch (error) {
        console.warn('video player update failed', error);
        return false;
    }
}

export function VideoSlide({ active, item, rect, registerVideo, onReady, playAllowed, muted, source }) {
    const { theme } = useTheme();
    const { kind: activeAudioKind, key: activeAudioKey, play: playAudio, pause: pauseAudio, clear: clearAudio } = useAudio();
    const { uri, loading, error } = source;
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
                            {formatDuration(shownTime)} / {formatDuration(duration)}
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
