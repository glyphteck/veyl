import { useCallback } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Image } from 'expo-image';
import { GestureDetector } from 'react-native-gesture-handler';
import { useMediaViewer } from '@/providers/mediaviewerprovider';
import { useTheme } from '@/providers/themeprovider';
import { getMediaViewerKey } from '@/lib/chatmediaitems';
import { imageWidth } from '@/lib/messages';
import { useMsgImage } from '@/lib/usemsgimage';
import { getImageAspect } from '@glyphteck/shared/chat/messages';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';
import { useMediaTapGesture } from './usemediatap';

const IMAGE_LONG_SCALE = 0.94;
const MEDIA_ACTIVE_STYLE = { opacity: 0.01 };

export default function ImageMessage({ msg, peerChatPK, fromPeer = false, menuItems, menuId, onLike, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const { theme } = useTheme();
    const { activeMediaId, openMedia } = useMediaViewer();
    const focused = useIsFocused();
    const { source, loading } = useMsgImage(peerChatPK, msg, focused);
    const aspect = getImageAspect(msg);
    const width = imageWidth(aspect);
    const hasCaption = typeof msg?.c === 'string' && msg.c.trim();
    const barePng = String(msg?.m || '').toLowerCase() === 'image/png' && !hasCaption;
    const key = getMediaViewerKey(peerChatPK, msg);
    const hasFile = !!(msg?.localUri || (msg?.p && msg?.k));
    const disabled = !key || !hasFile;
    const openFullscreen = useCallback(() => {
        if (disabled || activeMediaId === key) {
            return false;
        }
        return openMedia(key);
    }, [activeMediaId, disabled, key, openMedia]);
    const imageTapGesture = useMediaTapGesture({ disabled, msg, onLike, onOpen: openFullscreen });
    const renderImage = useCallback(
        () => (
            <View
                style={{
                    width: '100%',
                    aspectRatio: aspect,
                    backgroundColor: source ? (barePng ? 'transparent' : theme.border) : theme.border,
                    alignItems: source ? undefined : 'center',
                    justifyContent: source ? undefined : 'center',
                }}
            >
                {source ? (
                    <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="cover" enableLiveTextInteraction={false} />
                ) : loading ? (
                    <ActivityIndicator color={theme.foreground} />
                ) : (
                    <Text style={{ color: theme.muted, fontSize: 14 }}>image unavailable</Text>
                )}
            </View>
        ),
        [aspect, barePng, loading, source, theme.border, theme.foreground, theme.muted]
    );
    const renderPreview = useCallback(
        () => (
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer}>
                <View
                    style={{
                        width,
                        borderRadius: 22,
                        overflow: 'hidden',
                        backgroundColor: barePng ? 'transparent' : theme.background,
                    }}
                >
                    {renderImage()}
                    {hasCaption ? (
                        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                            <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '500' }}>{msg.c}</Text>
                        </View>
                    ) : null}
                </View>
            </ReactionTray>
        ),
        [barePng, fromPeer, hasCaption, msg?.c, reactionUsers, reactions, renderImage, theme.background, width]
    );

    return (
        <Menu id={menuId} items={menuItems} longScale={IMAGE_LONG_SCALE} activeStyle={MEDIA_ACTIVE_STYLE} renderPreview={renderPreview} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer}>
                <View
                    style={{
                        width,
                        borderRadius: 22,
                        overflow: 'hidden',
                        backgroundColor: barePng ? 'transparent' : theme.background,
                    }}
                >
                    <GestureDetector gesture={imageTapGesture}>{renderImage()}</GestureDetector>
                    {hasCaption ? (
                        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                            <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '500' }}>{msg.c}</Text>
                        </View>
                    ) : null}
                </View>
            </ReactionTray>
        </Menu>
    );
}
