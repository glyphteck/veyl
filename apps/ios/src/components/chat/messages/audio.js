import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Pause, Play } from 'lucide-react-native';
import { useChat } from '@/providers/chatprovider';
import { useAudio, useAudioState } from '@/providers/audioprovider';
import { useTheme } from '@/providers/themeprovider';
import { getCachedMessageFileUri, resolveMessageFileUri } from '@/lib/chat/downloads';
import { bubbleStyle } from '@/lib/chat/messages';
import { useGestureBlockers } from './gesturecontext';
import { getAttachmentCaption, getAttachmentTitle, hasStoredFileRef } from '@veyl/shared/chat/messages';
import { fileUri } from '@/lib/file';
import { formatDuration } from '@veyl/shared/utils/time';
import Icon from '@/components/icon';
import Menu from '@/components/menu';
import SeekBar from '@/components/seekbar';
import ReactionTray from './reactiontray';

const PLAY_TAP_SCALE = 0.9;
const PLAY_TAP_MAX_DURATION_MS = 240;
const PLAY_TAP_MAX_DISTANCE = 18;
const AUDIO_BUBBLE_WIDTH = 300;
const AUDIO_REPLY_SCALE = 0.56;
const PLAY_TAP_SPRING = {
    mass: 0.5,
    stiffness: 350,
    damping: 18,
};

export function AudioBubble({ msg, fromPeer = false, loading = false, disabled = false, timeLabel, progress = 0, onSeek, blockExternalGestures, playGesture, pressPlay, playStyle, icon = Play, inactive = false, compact = false }) {
    const { theme } = useTheme();
    const title = getAttachmentTitle(msg);
    const caption = getAttachmentCaption(msg);
    const duration = Number.isFinite(msg?.d) ? msg.d : 0;
    const label = timeLabel || `${formatDuration(0, { hours: false })} / ${formatDuration(duration, { hours: false })}`;
    const color = inactive ? theme.muted : theme.foreground;
    const seekDisabled = disabled || inactive || typeof onSeek !== 'function';
    const shownProgress = Math.max(0, Math.min(1, progress));
    const width = compact ? Math.round(AUDIO_BUBBLE_WIDTH * AUDIO_REPLY_SCALE) : AUDIO_BUBBLE_WIDTH;
    const controlSize = compact ? 32 : 44;
    const iconSize = compact ? 21 : 28;
    const gap = compact ? 9 : 12;
    const titleSize = compact ? 14 : 16;
    const timeSize = compact ? 11 : 13;
    const captionSize = compact ? 13 : 15;
    const barHeight = compact ? 22 : 28;
    const paddingHorizontal = compact ? 11 : 14;
    const paddingVertical = compact ? 9 : 12;
    const playControl = (
        <Animated.View
            accessible={typeof pressPlay === 'function'}
            accessibilityRole="button"
            accessibilityState={{ disabled: disabled || inactive }}
            onAccessibilityTap={pressPlay}
            style={[
                {
                    width: controlSize,
                    height: controlSize,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: disabled || inactive ? 0.45 : 1,
                },
                playStyle,
            ]}
        >
            {loading ? <ActivityIndicator color={theme.foreground} size="small" /> : <Icon icon={icon} color={color} size={iconSize} fill={color} strokeWidth={0} />}
        </Animated.View>
    );

    return (
        <View style={[bubbleStyle(theme, fromPeer), { width, maxWidth: '100%', borderRadius: 22, paddingHorizontal, paddingVertical, flexDirection: 'row', alignItems: 'center', gap }]}>
            {playGesture ? <GestureDetector gesture={playGesture}>{playControl}</GestureDetector> : playControl}
            <View style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' }}>
                <View style={{ minWidth: 0, flexDirection: 'row', alignItems: 'center', gap }}>
                    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color, fontSize: titleSize, fontWeight: '900' }}>
                        {title}
                    </Text>
                    {compact ? null : (
                        <Text numberOfLines={1} style={{ flexShrink: 0, color: theme.muted, fontSize: timeSize, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                            {label}
                        </Text>
                    )}
                </View>
                {seekDisabled ? (
                    <View style={{ height: barHeight, justifyContent: 'center', opacity: 0.45, marginTop: 3 }}>
                        <View style={{ height: 4, borderRadius: 999, backgroundColor: theme.border, overflow: 'hidden' }}>
                            <View style={{ width: `${shownProgress * 100}%`, height: '100%', backgroundColor: color }} />
                        </View>
                    </View>
                ) : (
                    <SeekBar progress={shownProgress} disabled={false} onSeek={onSeek} blockExternalGestures={blockExternalGestures} trackColor={theme.border} fillColor={color} height={barHeight} style={{ marginTop: 3 }} />
                )}
                {caption ? <Text style={{ marginTop: compact ? 6 : 8, color, fontSize: captionSize, fontWeight: '500' }}>{caption}</Text> : null}
            </View>
        </View>
    );
}

export default function AudioMessage({ msg, peerChatPK, fromPeer = false, menuItems, menuId, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const { readMessageFile } = useChat();
    const { kind, key: audioKey, getPosition, play, pause, seek } = useAudio();
    const { key: audioStateKey, status: audioStatus } = useAudioState();
    const blockExternalGestures = useGestureBlockers({ includeLike: true });
    const playScale = useSharedValue(1);
    const initialUri = fileUri(getCachedMessageFileUri(msg, peerChatPK));
    const [uri, setUri] = useState(() => initialUri);
    const [loading, setLoading] = useState(() => msg?.t === 'm4a' && !initialUri && hasStoredFileRef(msg));
    const [error, setError] = useState('');
    const [knownDuration, setKnownDuration] = useState(() => (Number.isFinite(msg?.d) ? msg.d : 0));
    const [storedTime, setStoredTime] = useState(0);
    const title = getAttachmentTitle(msg);
    const key = `${peerChatPK || ''}:${msg?.p || msg?.localUri || ''}:${msg?.k || ''}`;
    const metadataSource = useMemo(() => (uri ? { uri } : null), [uri]);
    const metadataPlayer = useAudioPlayer(metadataSource, { updateInterval: 1000, keepAudioSessionActive: false });
    const metadataStatus = useAudioPlayerStatus(metadataPlayer);
    const active = kind === 'audio' && audioKey === key;
    const status = active && audioStateKey === key ? audioStatus : null;
    const duration = knownDuration;
    const rawCurrentTime = Number.isFinite(status?.currentTime) ? status.currentTime : storedTime;
    const currentTime = duration > 0 ? Math.max(0, Math.min(duration, rawCurrentTime)) : Math.max(0, rawCurrentTime);
    const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
    const disabled = loading || !!error || !uri;
    const timeLabel = loading ? 'loading...' : error || `${formatDuration(currentTime, { hours: false })} / ${formatDuration(duration, { hours: false })}`;
    const latestRef = useRef({ active, currentTime, disabled, duration, key, pause, play, seek, status, title, uri });

    latestRef.current = { active, currentTime, disabled, duration, key, pause, play, seek, status, title, uri };

    useEffect(() => {
        let cancelled = false;
        const localUri = fileUri(getCachedMessageFileUri(msg, peerChatPK));

        if (localUri) {
            setUri(localUri);
            setLoading(false);
            setError('');
            return;
        }

        if (msg?.t !== 'm4a' || !peerChatPK || !hasStoredFileRef(msg)) {
            setUri('');
            setLoading(false);
            setError('');
            return;
        }

        setUri('');
        setLoading(true);
        setError('');
        resolveMessageFileUri(msg, peerChatPK, readMessageFile, { defer: true })
            .then((nextUri) => {
                if (cancelled) {
                    return;
                }
                setUri(fileUri(nextUri));
                setLoading(false);
            })
            .catch((nextError) => {
                if (cancelled) {
                    return;
                }
                console.warn('chat audio load failed', nextError);
                setError(nextError?.message || 'audio unavailable');
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [msg?.k, msg?.localUri, msg?.m, msg?.p, msg?.t, peerChatPK, readMessageFile]);

    useEffect(() => {
        setKnownDuration(Number.isFinite(msg?.d) ? msg.d : 0);
        setStoredTime(getPosition(key));
    }, [getPosition, key, msg?.d]);

    useEffect(() => {
        const nextDuration =
            Number.isFinite(status?.duration) && status.duration > 0
                ? status.duration
                : Number.isFinite(metadataStatus?.duration) && metadataStatus.duration > 0
                  ? metadataStatus.duration
                  : Number.isFinite(metadataPlayer?.duration) && metadataPlayer.duration > 0
                    ? metadataPlayer.duration
                    : Number.isFinite(msg?.d) && msg.d > 0
                      ? msg.d
                      : 0;
        if (nextDuration > 0) {
            setKnownDuration((current) => (current === nextDuration ? current : nextDuration));
        }
    }, [metadataPlayer?.duration, metadataStatus?.duration, msg?.d, status?.duration]);

    useEffect(() => {
        if (active) {
            return;
        }
        const nextStoredTime = getPosition(key);
        setStoredTime((current) => (current === nextStoredTime ? current : nextStoredTime));
    }, [active, getPosition, key]);

    useEffect(() => {
        if (!active || !Number.isFinite(status?.currentTime)) {
            return;
        }
        setStoredTime((current) => (current === status.currentTime ? current : status.currentTime));
    }, [active, status?.currentTime]);

    const pressPlay = useCallback(() => {
        const latest = latestRef.current;
        if (latest.disabled) {
            return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});

        if (latest.active && latest.status?.playing) {
            latest.pause({ kind: 'audio', key: latest.key });
            return;
        }

        if (latest.duration > 0 && latest.currentTime >= latest.duration) {
            latest.seek(0, { key: latest.key });
        }
        latest.play({ kind: 'audio', key: latest.key, uri: latest.uri, title: latest.title });
    }, []);

    const handleSeek = useCallback(
        (nextProgress) => {
            if (!duration || disabled) {
                return;
            }
            const nextTime = nextProgress * duration;
            setStoredTime(nextTime);
            seek(nextTime, { key });
        },
        [disabled, duration, key, seek]
    );
    const playGesture = useMemo(() => {
        let gesture = Gesture.Tap()
            .enabled(!disabled)
            .maxDuration(PLAY_TAP_MAX_DURATION_MS)
            .maxDistance(PLAY_TAP_MAX_DISTANCE)
            .hitSlop(10)
            .onTouchesDown(() => {
                'worklet';
                playScale.value = withSpring(PLAY_TAP_SCALE, PLAY_TAP_SPRING);
            })
            .onFinalize(() => {
                'worklet';
                playScale.value = withSpring(1, PLAY_TAP_SPRING);
            })
            .onEnd((_event, success) => {
                'worklet';
                if (success) {
                    scheduleOnRN(pressPlay);
                }
            });
        if (blockExternalGestures.length) {
            gesture = gesture.blocksExternalGesture(...blockExternalGestures);
        }
        return gesture;
    }, [blockExternalGestures, disabled, playScale, pressPlay]);
    const playStyle = useAnimatedStyle(() => ({
        transform: [{ scale: playScale.value }],
    }));
    const icon = useMemo(() => (active && status?.playing ? Pause : Play), [active, status?.playing]);

    return (
        <Menu id={menuId} items={menuItems} blockExternalGestures={blockExternalGestures} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer}>
                <AudioBubble msg={msg} fromPeer={fromPeer} loading={loading} disabled={disabled} timeLabel={timeLabel} progress={progress} onSeek={handleSeek} blockExternalGestures={blockExternalGestures} playGesture={playGesture} pressPlay={pressPlay} playStyle={playStyle} icon={icon} />
            </ReactionTray>
        </Menu>
    );
}
