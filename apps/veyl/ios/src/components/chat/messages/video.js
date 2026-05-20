import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Play } from 'lucide-react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useChat } from '@/providers/chatprovider';
import { useMediaViewer } from '@/providers/mediaviewerprovider';
import { useTheme } from '@/providers/themeprovider';
import { getCachedMessageFileUri, resolveMessageFileUri } from '@/lib/chatdownloads';
import { getMediaViewerKey } from '@/lib/chatmediaitems';
import { getCachedVideoPreviewUri, loadVideoPreviewUri } from '@/lib/chatvideopreview';
import { imageWidth } from '@/lib/messages';
import { getAttachmentCaption, getImageAspect, isExpiredAttachmentMsg } from '@glyphteck/shared/chat/messages';
import { getMessagePreviewCacheKey } from '@glyphteck/shared/chat/previews';
import Icon from '@/components/icon';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';
import { useMediaTapGesture } from './usemediatap';

const VIDEO_LONG_SCALE = 0.94;
const VIDEO_RADIUS = 22;
const MEDIA_ACTIVE_STYLE = { opacity: 0.01 };

function normalizeUri(uri) {
    if (typeof uri !== 'string' || !uri) {
        return '';
    }
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `file://${uri}`;
}

export default function VideoMessage({ msg, peerChatPK, fromPeer = false, menuItems, menuId, onLike, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const { theme } = useTheme();
    const { readMessageFile, readMessagePreview, writeMessagePreview } = useChat();
    const { activeMediaId, openMedia } = useMediaViewer();
    const msgType = msg?.t;
    const msgPath = msg?.p;
    const msgKey = msg?.k;
    const msgMime = msg?.m;
    const msgName = msg?.n;
    const msgLocalUri = msg?.localUri;
    const msgExpiresAt = msg?.x;
    const fileMsg = useMemo(
        () => ({ t: msgType, p: msgPath, k: msgKey, m: msgMime, n: msgName, localUri: msgLocalUri, x: msgExpiresAt }),
        [msgExpiresAt, msgKey, msgLocalUri, msgMime, msgName, msgPath, msgType]
    );
    const expired = isExpiredAttachmentMsg(fileMsg);
    const initialUri = normalizeUri(getCachedMessageFileUri(fileMsg, peerChatPK));
    const [uri, setUri] = useState(() => initialUri);
    const [loading, setLoading] = useState(() => msgType === 'mp4' && !initialUri && !!msgPath && !!msgKey);
    const [error, setError] = useState('');
    const key = getMediaViewerKey(peerChatPK, msg);
    const previewKey = getMessagePreviewCacheKey(peerChatPK, fileMsg);
    const [previewUri, setPreviewUri] = useState(() => (expired ? '' : getCachedVideoPreviewUri(peerChatPK, fileMsg)));
    const aspect = getImageAspect(msg, 16 / 9);
    const width = imageWidth(aspect);
    const caption = getAttachmentCaption(msg);
    const busy = loading;
    const disabled = loading || !!error || !uri || !key;

    useEffect(() => {
        if (!previewKey || error || expired) {
            setPreviewUri('');
            return;
        }

        const cachedPreview = getCachedVideoPreviewUri(peerChatPK, fileMsg);
        if (cachedPreview) {
            setPreviewUri(cachedPreview);
            return;
        }

        let cancelled = false;
        loadVideoPreviewUri({ peerChatPK, msg: fileMsg, uri, width, readMessagePreview, writeMessagePreview })
            .then((nextPreviewUri) => {
                if (!cancelled) {
                    setPreviewUri(nextPreviewUri);
                }
            })
            .catch((nextError) => {
                if (!cancelled && nextError?.message !== 'video preview pending') {
                    console.warn('chat video preview failed', nextError);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [error, expired, fileMsg, peerChatPK, previewKey, readMessagePreview, uri, width, writeMessagePreview]);

    useEffect(() => {
        let cancelled = false;
        const localUri = normalizeUri(getCachedMessageFileUri(fileMsg, peerChatPK));

        if (localUri) {
            setUri(localUri);
            setLoading(false);
            setError('');
            return;
        }

        if (msgType !== 'mp4' || !peerChatPK || !msgPath || !msgKey) {
            setUri('');
            setLoading(false);
            setError('');
            return;
        }

        setUri('');
        setLoading(true);
        setError('');
        resolveMessageFileUri(fileMsg, peerChatPK, readMessageFile, { defer: true })
            .then((nextUri) => {
                if (cancelled) return;
                setUri(normalizeUri(nextUri));
                setLoading(false);
            })
            .catch((nextError) => {
                if (cancelled) return;
                console.warn('chat video load failed', nextError);
                setError(nextError?.message || 'video unavailable');
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [fileMsg, msgKey, msgPath, msgType, peerChatPK, readMessageFile]);

    const openFullscreen = useCallback(() => {
        if (disabled || activeMediaId === key) {
            return false;
        }
        return openMedia(key);
    }, [activeMediaId, disabled, key, openMedia]);
    const fullscreenTapGesture = useMediaTapGesture({ disabled, msg, onLike, onOpen: openFullscreen });

    const videoContent = (
        <View
            collapsable={false}
            style={{ width: '100%', aspectRatio: aspect, backgroundColor: theme.border }}
        >
            {previewUri ? <Image source={{ uri: previewUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" enableLiveTextInteraction={false} /> : uri && !error ? null : (
                <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                    {loading ? <ActivityIndicator color={theme.foreground} /> : <Text style={{ color: theme.muted, fontSize: 14 }}>{error || 'video unavailable'}</Text>}
                </View>
            )}
            {uri && !error ? (
                <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            width: 58,
                            height: 58,
                            marginLeft: -29,
                            marginTop: -29,
                            borderRadius: 999,
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: disabled ? 0.45 : 1,
                        }}
                    >
                        {busy && !previewUri ? <ActivityIndicator color="#fff" size="small" /> : <Icon icon={Play} color="#fff" size={38} fill="#fff" strokeWidth={0} />}
                    </View>
                </View>
            ) : null}
        </View>
    );

    const videoSurface = (
        <GestureDetector gesture={fullscreenTapGesture}>
            {videoContent}
        </GestureDetector>
    );
    const renderPreview = useCallback(
        () => (
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer}>
                <View style={{ width, borderRadius: VIDEO_RADIUS, overflow: 'hidden', backgroundColor: theme.background }}>
                    <View
                        style={{
                            width: '100%',
                            aspectRatio: aspect,
                            backgroundColor: theme.border,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {previewUri ? <Image source={{ uri: previewUri }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} contentFit="cover" enableLiveTextInteraction={false} /> : null}
                        {busy && !previewUri ? <ActivityIndicator color="#fff" size="small" /> : <Icon icon={Play} color="#fff" size={38} fill="#fff" strokeWidth={0} />}
                    </View>
                    {caption ? (
                        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                            <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '500' }}>{caption}</Text>
                        </View>
                    ) : null}
                </View>
            </ReactionTray>
        ),
        [aspect, busy, caption, fromPeer, previewUri, reactionUsers, reactions, theme.background, theme.border, theme.foreground, width]
    );

    return (
        <Menu
            id={menuId}
            items={menuItems}
            longScale={VIDEO_LONG_SCALE}
            activeStyle={MEDIA_ACTIVE_STYLE}
            renderPreview={renderPreview}
            previewBottomInset={reactionPreviewInset}
        >
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer}>
                <View style={{ width, borderRadius: VIDEO_RADIUS, overflow: 'hidden', backgroundColor: theme.background }}>
                    {videoSurface}
                    {caption ? (
                        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                            <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '500' }}>{caption}</Text>
                        </View>
                    ) : null}
                </View>
            </ReactionTray>
        </Menu>
    );
}
