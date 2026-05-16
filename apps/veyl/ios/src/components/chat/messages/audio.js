import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Pause, Play } from 'lucide-react-native';
import { useChat } from '@/providers/chatprovider';
import { useAudio, useAudioState } from '@/providers/audioprovider';
import { useTheme } from '@/providers/themeprovider';
import { getCachedMessageFileUri, resolveMessageFileUri } from '@/lib/chatdownloads';
import { useTap } from '@/lib/tap';
import { bubbleTint } from '@/lib/messages';
import { useMessageGesture } from '@/components/chat/messagegesturecontext';
import { getAttachmentCaption, getAttachmentTitle } from '@glyphteck/shared/chat/messages';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import Menu from '@/components/menu';
import SeekBar from '@/components/seekbar';
import ReactionTray from './reactiontray';

function fmtTime(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return '0:00';
    }

    const total = Math.floor(value);
    const mins = Math.floor(total / 60);
    const secs = String(total % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

function normalizeUri(uri) {
    if (typeof uri !== 'string' || !uri) {
        return '';
    }
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `file://${uri}`;
}

export default function AudioMessage({ msg, peerChatPK, fromPeer = false, menuItems, menuId, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const { theme } = useTheme();
    const { readMessageFile } = useChat();
    const { kind, key: audioKey, play, pause, seek } = useAudio();
    const { status: audioStatus } = useAudioState();
    const { blockLike, setSwipeBlocked } = useMessageGesture();
    const initialUri = normalizeUri(getCachedMessageFileUri(msg, peerChatPK));
    const [uri, setUri] = useState(() => initialUri);
    const [loading, setLoading] = useState(() => msg?.t === 'mp3' && !initialUri && !!msg?.p && !!msg?.k);
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
    const timeLabel = loading ? 'loading...' : error || `${fmtTime(currentTime)} / ${fmtTime(duration)}`;

    useEffect(() => {
        let cancelled = false;
        const localUri = normalizeUri(getCachedMessageFileUri(msg, peerChatPK));

        if (localUri) {
            setUri(localUri);
            setLoading(false);
            setError('');
            return;
        }

        if (msg?.t !== 'mp3' || !peerChatPK || !msg?.p || !msg?.k) {
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
                setUri(normalizeUri(nextUri));
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

    const toggle = useCallback(() => {
        if (disabled) {
            return;
        }

        if (active && status?.playing) {
            pause({ kind: 'audio', key });
            return;
        }

        play({ kind: 'audio', key, uri, title });
        if (active && (status?.didJustFinish || (duration > 0 && currentTime >= duration))) {
            seek(0);
        }
    }, [active, currentTime, disabled, duration, key, pause, play, seek, status?.didJustFinish, status?.playing, title, uri]);

    const playTap = useTap({ onPress: toggle, disabled });

    const handleSeek = useCallback(
        (nextProgress) => {
            if (!active || !duration || disabled) {
                return;
            }
            seek(nextProgress * duration);
        },
        [active, disabled, duration, seek]
    );
    const blockSwipe = useCallback(() => setSwipeBlocked(true), [setSwipeBlocked]);
    const releaseSwipe = useCallback(() => setSwipeBlocked(false), [setSwipeBlocked]);
    const playProps = useMemo(
        () => ({
            ...playTap.props,
            onPressIn: (event) => {
                blockLike();
                playTap.props.onPressIn?.(event);
            },
        }),
        [blockLike, playTap.props]
    );
    const icon = useMemo(() => (active && status?.playing ? Pause : Play), [active, status?.playing]);

    return (
        <Menu id={menuId} items={menuItems} previewBottomInset={reactionPreviewInset}>
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
                    <Pressable {...playProps} hitSlop={10} accessibilityState={{ disabled }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1 }}>
                        {loading ? <ActivityIndicator color={theme.foreground} size="small" /> : <Icon icon={icon} color={theme.foreground} size={28} fill={theme.foreground} strokeWidth={0} />}
                    </Pressable>
                    <View style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' }}>
                        <View style={{ minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: theme.foreground, fontSize: 16, fontWeight: '900' }}>
                                {title}
                            </Text>
                            <Text numberOfLines={1} style={{ flexShrink: 0, color: theme.muted, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                                {timeLabel}
                            </Text>
                        </View>
                        <SeekBar progress={progress} disabled={disabled} onSeek={handleSeek} onDragStart={blockSwipe} onDragEnd={releaseSwipe} trackColor={theme.border} fillColor={theme.foreground} style={{ marginTop: 3 }} seekOnStart={false} />
                        {caption ? <Text style={{ marginTop: 8, color: theme.foreground, fontSize: 15, fontWeight: '500' }}>{caption}</Text> : null}
                    </View>
                </GlassView>
            </ReactionTray>
        </Menu>
    );
}
