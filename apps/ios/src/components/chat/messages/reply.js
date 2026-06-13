import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { File, Play } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useChat } from '@/providers/chatprovider';
import { useTheme } from '@/providers/themeprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useUser } from '@/providers/userprovider';
import { bubbleStyle, imageWidth } from '@/lib/chat/messages';
import { getCachedMessageFileUri, resolveMessageFileUri } from '@/lib/chat/downloads';
import { useMsgImage } from '@/lib/chat/useimage';
import { getCachedVideoPreviewUri, loadVideoPreviewUri } from '@/lib/chat/videopreview';
import { fileUri } from '@/lib/file';
import { UNAVAILABLE_REPLY_MSG_TYPE, getAttachmentCaption, getAttachmentTitle, getImageAspect, getRequestContext, isExpiredAttachmentMsg, makeUnavailableReply } from '@veyl/shared/chat/messages';
import { getMessagePreviewCacheKey } from '@veyl/shared/chat/previews';
import { useGestureBlockers } from './gesturecontext';
import Icon from '@/components/icon';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';
import { AudioBubble } from './audio';
import { TextBubble } from './text';

function ReplyPressable({ blockExternalGestures, onReplyPress, children }) {
    const canPress = typeof onReplyPress === 'function';
    const latestRef = useRef({ onReplyPress });
    latestRef.current = { onReplyPress };

    const press = useCallback(() => {
        latestRef.current.onReplyPress?.();
    }, []);

    const tapGesture = useMemo(() => {
        let gesture = Gesture.Tap()
            .enabled(canPress)
            .maxDuration(240)
            .maxDistance(18)
            .runOnJS(true)
            .onEnd((_event, success) => {
                if (success) {
                    press();
                }
            });
        if (blockExternalGestures?.length) {
            gesture = gesture.blocksExternalGesture(...blockExternalGestures);
        }
        return gesture;
    }, [blockExternalGestures, canPress, press]);

    return (
        <GestureDetector gesture={tapGesture}>
            <View accessible={canPress} accessibilityRole="button" onAccessibilityTap={press} style={{ maxWidth: '100%' }}>
                {children}
            </View>
        </GestureDetector>
    );
}

function ReplyText({ blockExternalGestures, reply, replyFromPeer, onReplyPress }) {
    return (
        <ReplyPressable blockExternalGestures={blockExternalGestures} onReplyPress={onReplyPress}>
            <TextBubble msg={reply} fromPeer={replyFromPeer} compact singleLine muted allowEmoji={false} />
        </ReplyPressable>
    );
}

function ReplyUnavailable({ blockExternalGestures, reply, replyFromPeer, onReplyPress }) {
    return (
        <ReplyPressable blockExternalGestures={blockExternalGestures} onReplyPress={onReplyPress}>
            <TextBubble msg={reply} fromPeer={replyFromPeer} compact singleLine muted allowEmoji={false} />
        </ReplyPressable>
    );
}

function ReplyRequest({ blockExternalGestures, reply, replyFromPeer, peerDisplayName, onReplyPress }) {
    const { theme } = useTheme();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { getTxById } = useTxData();
    const { amount, label } = getRequestContext(reply, { fromPeer: replyFromPeer, peerDisplayName, moneyFormat: settings?.moneyFormat, btcPrice: bitcoin?.price, getTxById });

    return (
        <ReplyPressable blockExternalGestures={blockExternalGestures} onReplyPress={onReplyPress}>
            <View
                style={{
                    ...bubbleStyle(theme, replyFromPeer),
                    maxWidth: '100%',
                    borderRadius: 20,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                }}
            >
                <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 11, fontWeight: '900' }}>
                    {label}
                </Text>
                <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 24, fontWeight: '900' }}>
                    {amount}
                </Text>
            </View>
        </ReplyPressable>
    );
}

function ReplyImage({ blockExternalGestures, reply, peerChatPK, onReplyPress }) {
    const { theme } = useTheme();
    const { source, loading } = useMsgImage(peerChatPK, reply, true);
    const aspect = getImageAspect(reply);
    const width = Math.round(Math.min(150, imageWidth(aspect) * 0.56));

    return (
        <ReplyPressable blockExternalGestures={blockExternalGestures} onReplyPress={onReplyPress}>
            <View
                style={{
                    width,
                    maxWidth: '100%',
                    borderRadius: 20,
                    overflow: 'hidden',
                    backgroundColor: theme.background,
                    opacity: 0.65,
                }}
            >
                {source ? (
                    <Image source={source} style={{ width: '100%', aspectRatio: aspect, backgroundColor: theme.border }} contentFit="cover" enableLiveTextInteraction={false} />
                ) : (
                    <View
                        style={{
                            width: '100%',
                            aspectRatio: aspect,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: theme.border,
                        }}
                    >
                        {loading ? <ActivityIndicator color={theme.foreground} size="small" /> : <Text style={{ color: theme.muted, fontSize: 12 }}>image unavailable</Text>}
                    </View>
                )}
                {typeof reply?.c === 'string' && reply.c.trim() ? (
                    <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
                        <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 14, fontWeight: '500' }}>
                            {reply.c}
                        </Text>
                    </View>
                ) : null}
            </View>
        </ReplyPressable>
    );
}

function ReplyVideo({ blockExternalGestures, reply, peerChatPK, onReplyPress }) {
    const { theme } = useTheme();
    const { readMessageFile, readMessagePreview, writeMessagePreview } = useChat();
    const msgType = reply?.t;
    const msgPath = reply?.p;
    const msgKey = reply?.k;
    const msgMime = reply?.m;
    const msgName = reply?.n;
    const msgLocalUri = reply?.localUri;
    const msgExpiresAt = reply?.x;
    const fileMsg = useMemo(
        () => ({ t: msgType, p: msgPath, k: msgKey, m: msgMime, n: msgName, localUri: msgLocalUri, x: msgExpiresAt }),
        [msgExpiresAt, msgKey, msgLocalUri, msgMime, msgName, msgPath, msgType]
    );
    const expired = isExpiredAttachmentMsg(fileMsg);
    const previewKey = getMessagePreviewCacheKey(peerChatPK, fileMsg);
    const initialPreviewUri = expired ? '' : getCachedVideoPreviewUri(peerChatPK, fileMsg);
    const [previewUri, setPreviewUri] = useState(() => initialPreviewUri);
    const [loading, setLoading] = useState(() => !expired && !!previewKey && !initialPreviewUri);
    const aspect = getImageAspect(reply, 16 / 9);
    const width = Math.round(Math.min(150, imageWidth(aspect) * 0.56));
    const caption = getAttachmentCaption(reply);

    useEffect(() => {
        if (!previewKey || expired) {
            setPreviewUri('');
            setLoading(false);
            return;
        }

        const cachedPreview = getCachedVideoPreviewUri(peerChatPK, fileMsg);
        if (cachedPreview) {
            setPreviewUri(cachedPreview);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setPreviewUri('');
        setLoading(true);

        const load = async () => {
            let nextPreviewUri = '';
            try {
                nextPreviewUri = await loadVideoPreviewUri({ peerChatPK, msg: fileMsg, uri: '', width, readMessagePreview, writeMessagePreview });
            } catch (previewError) {
                if (previewError?.message !== 'video preview pending') {
                    throw previewError;
                }
            }

            if (!nextPreviewUri) {
                const sourceUri = fileUri(getCachedMessageFileUri(fileMsg, peerChatPK)) || fileUri(await resolveMessageFileUri(fileMsg, peerChatPK, readMessageFile, { defer: true }));
                nextPreviewUri = await loadVideoPreviewUri({ peerChatPK, msg: fileMsg, uri: sourceUri, width, readMessagePreview, writeMessagePreview });
            }

            if (!cancelled) {
                setPreviewUri(nextPreviewUri || '');
                setLoading(false);
            }
        };

        load().catch((nextError) => {
            if (!cancelled) {
                if (nextError?.message !== 'video preview unavailable' && nextError?.message !== 'file unavailable' && nextError?.message !== 'video unavailable') {
                    console.warn('chat reply video preview failed', nextError);
                }
                setPreviewUri('');
                setLoading(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [expired, fileMsg, peerChatPK, previewKey, readMessageFile, readMessagePreview, width, writeMessagePreview]);

    return (
        <ReplyPressable blockExternalGestures={blockExternalGestures} onReplyPress={onReplyPress}>
            <View
                style={{
                    width,
                    maxWidth: '100%',
                    borderRadius: 20,
                    overflow: 'hidden',
                    backgroundColor: theme.background,
                    opacity: 0.65,
                }}
            >
                <View style={{ width: '100%', aspectRatio: aspect, backgroundColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
                    {previewUri ? <Image source={{ uri: previewUri }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} contentFit="cover" enableLiveTextInteraction={false} /> : null}
                    {loading && !previewUri ? <ActivityIndicator color={theme.foreground} size="small" /> : <Icon icon={Play} color="#fff" size={30} fill="#fff" strokeWidth={0} />}
                </View>
                {caption ? (
                    <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
                        <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 14, fontWeight: '500' }}>
                            {caption}
                        </Text>
                    </View>
                ) : null}
            </View>
        </ReplyPressable>
    );
}

function ReplyAttachment({ blockExternalGestures, reply, replyFromPeer, onReplyPress }) {
    const { theme } = useTheme();
    const title = getAttachmentTitle(reply);
    const caption = getAttachmentCaption(reply);

    return (
        <ReplyPressable blockExternalGestures={blockExternalGestures} onReplyPress={onReplyPress}>
            <View
                style={{
                    ...bubbleStyle(theme, replyFromPeer),
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    maxWidth: '100%',
                    borderRadius: 20,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                }}
            >
                <File color={theme.foreground} size={16} />
                <View style={{ flexShrink: 1 }}>
                    <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 14, fontWeight: '900' }}>
                        {title}
                    </Text>
                    {caption ? (
                        <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 12, fontWeight: '500' }}>
                            {caption}
                        </Text>
                    ) : null}
                </View>
            </View>
        </ReplyPressable>
    );
}

function ReplyAudio({ blockExternalGestures, reply, replyFromPeer, onReplyPress }) {
    return (
        <ReplyPressable blockExternalGestures={blockExternalGestures} onReplyPress={onReplyPress}>
            <AudioBubble msg={reply} fromPeer={replyFromPeer} disabled inactive compact />
        </ReplyPressable>
    );
}

function ReplyPreview({ blockExternalGestures, reply, replyFromPeer, peerChatPK, peerDisplayName, onReplyPress }) {
    switch (reply?.t) {
        case UNAVAILABLE_REPLY_MSG_TYPE:
            return <ReplyUnavailable blockExternalGestures={blockExternalGestures} reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        case 'txt':
            return <ReplyText blockExternalGestures={blockExternalGestures} reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        case 'req':
            return <ReplyRequest blockExternalGestures={blockExternalGestures} reply={reply} replyFromPeer={replyFromPeer} peerDisplayName={peerDisplayName} onReplyPress={onReplyPress} />;
        case 'img':
        case 'gif':
            return <ReplyImage blockExternalGestures={blockExternalGestures} reply={reply} peerChatPK={peerChatPK} onReplyPress={onReplyPress} />;
        case 'mp4':
            return <ReplyVideo blockExternalGestures={blockExternalGestures} reply={reply} peerChatPK={peerChatPK} onReplyPress={onReplyPress} />;
        case 'm4a':
            return <ReplyAudio blockExternalGestures={blockExternalGestures} reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        case 'file':
            return <ReplyAttachment blockExternalGestures={blockExternalGestures} reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        default:
            return null;
    }
}

export default function ReplyMessage({ msg, fromPeer = false, menuItems, menuId, reply, replyFromPeer = false, peerChatPK, peerDisplayName, onReplyPress, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const blockExternalGestures = useGestureBlockers();
    const replyPreviewBlockers = useGestureBlockers({ includeLike: true });
    const body = (
        <Menu id={menuId} items={menuItems} blockExternalGestures={blockExternalGestures} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer}>
                <TextBubble msg={msg} fromPeer={fromPeer} allowEmoji={false} />
            </ReactionTray>
        </Menu>
    );
    const replyPreview = reply || (msg?.r ? makeUnavailableReply() : null);

    if (!replyPreview) {
        return body;
    }

    return (
        <View style={{ maxWidth: '100%', gap: 6, alignItems: fromPeer ? 'flex-start' : 'flex-end' }}>
            <ReplyPreview blockExternalGestures={replyPreviewBlockers} reply={replyPreview} replyFromPeer={replyFromPeer} peerChatPK={peerChatPK} peerDisplayName={peerDisplayName} onReplyPress={onReplyPress} />
            <View style={{ maxWidth: '100%' }}>
                {body}
            </View>
        </View>
    );
}
