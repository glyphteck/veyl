import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Pause, Play } from 'lucide-react-native';
import { useChat } from '@/providers/chatprovider';
import { useAudio, useAudioState } from '@/providers/audioprovider';
import { useTheme } from '@/providers/themeprovider';
import { getCachedMessageFileUri, resolveMessageFileUri } from '@/lib/chat/downloads';
import { bubbleTint } from '@/lib/chat/messages';
import { useMessageGestureBlockers } from '@/components/chat/messagegesturecontext';
import { getAttachmentCaption, getAttachmentTitle, hasStoredFileRef } from '@veyl/shared/chat/messages';
import { fileUri } from '@/lib/file';
import { formatDuration } from '@veyl/shared/utils/time';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import Menu from '@/components/menu';
import SeekBar from '@/components/seekbar';
import ReactionTray from './reactiontray';

const PLAY_TAP_SCALE = 0.9;
const PLAY_TAP_MAX_DURATION_MS = 240;
const PLAY_TAP_MAX_DISTANCE = 18;
const PLAY_TAP_SPRING = {
    mass: 0.5,
    stiffness: 350,
    damping: 18,
};

export default function AudioMessage({ msg, peerChatPK, fromPeer = false, menuItems, menuId, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const { theme } = useTheme();
    const { readMessageFile } = useChat();
    const { kind, key: audioKey, play, pause, seek } = useAudio();
    const { status: audioStatus } = useAudioState();
    const blockExternalGestures = useMessageGestureBlockers({ includeLike: true });
    const playScale = useSharedValue(1);
    const initialUri = fileUri(getCachedMessageFileUri(msg, peerChatPK));
    const [uri, setUri] = useState(() => initialUri);
    const [loading, setLoading] = useState(() => msg?.t === 'mp3' && !initialUri && hasStoredFileRef(msg));
    const [error, setError] = useState('');
    const title = getAttachmentTitle(msg);
    const caption = getAttachmentCaption(msg);
    const key = `${peerChatPK || ''}:${msg?.p || msg?.localUri || ''}:${msg?.k || ''}`;
    const active = kind === 'audio' && audioKey === key;
    const status = active ? audioStatus : null;
    const duration = Number.isFinite(status?.duration) && status.duration > 0 ? status.duration : Number.isFinite(msg?.d) ? msg.d : 0;
    const currentTime = Number.isFinite(status?.currentTime) ? status.currentTime : 0;
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

        if (msg?.t !== 'mp3' || !peerChatPK || !hasStoredFileRef(msg)) {
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

        latest.play({ kind: 'audio', key: latest.key, uri: latest.uri, title: latest.title });
        if (latest.active && (latest.status?.didJustFinish || (latest.duration > 0 && latest.currentTime >= latest.duration))) {
            latest.seek(0);
        }
    }, []);

    const handleSeek = useCallback(
        (nextProgress) => {
            if (!active || !duration || disabled) {
                return;
            }
            seek(nextProgress * duration);
        },
        [active, disabled, duration, seek]
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
                <GlassView
                    glassEffectStyle="clear"
                    tintColor={bubbleTint(theme, fromPeer)}
                    style={{
                        width: 300,
                        maxWidth: '100%',
                        borderRadius: 22,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                    }}
                >
                    <GestureDetector gesture={playGesture}>
                        <Animated.View accessible accessibilityRole="button" accessibilityState={{ disabled }} onAccessibilityTap={pressPlay} style={[{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1 }, playStyle]}>
                            {loading ? <ActivityIndicator color={theme.foreground} size="small" /> : <Icon icon={icon} color={theme.foreground} size={28} fill={theme.foreground} strokeWidth={0} />}
                        </Animated.View>
                    </GestureDetector>
                    <View style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' }}>
                        <View style={{ minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: theme.foreground, fontSize: 16, fontWeight: '900' }}>
                                {title}
                            </Text>
                            <Text numberOfLines={1} style={{ flexShrink: 0, color: theme.muted, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                                {timeLabel}
                            </Text>
                        </View>
                        <SeekBar progress={progress} disabled={disabled} onSeek={handleSeek} blockExternalGestures={blockExternalGestures} trackColor={theme.border} fillColor={theme.foreground} style={{ marginTop: 3 }} seekOnStart={false} />
                        {caption ? <Text style={{ marginTop: 8, color: theme.foreground, fontSize: 15, fontWeight: '500' }}>{caption}</Text> : null}
                    </View>
                </GlassView>
            </ReactionTray>
        </Menu>
    );
}
