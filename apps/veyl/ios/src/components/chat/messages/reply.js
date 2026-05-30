import { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { File } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { bubbleTint, imageWidth } from '@/lib/messages';
import { useMsgImage } from '@/lib/usemsgimage';
import { UNAVAILABLE_REPLY_MSG_TYPE, getAttachmentCaption, getAttachmentTitle, getImageAspect, makeUnavailableReply } from '@glyphteck/shared/chat/messages';
import { renderMoney } from '@glyphteck/shared/utils';
import { useMessageGestureBlockers } from '@/components/chat/messagegesturecontext';
import GlassView from '@/components/glass/glassview';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';
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
    const msgTx = reply.tx ? getTxById?.(reply.tx) : null;
    const displayAmount = msgTx ? Math.abs(Number(msgTx.amount)) : Number(reply.a);
    const amount = renderMoney(displayAmount, settings?.moneyFormat, bitcoin?.price);
    const label = reply.tx ? (replyFromPeer ? 'You sent' : 'You received') : replyFromPeer ? `${peerDisplayName || 'They'} requested` : 'You requested';

    return (
        <ReplyPressable blockExternalGestures={blockExternalGestures} onReplyPress={onReplyPress}>
            <GlassView
                glassEffectStyle="clear"
                tintColor={bubbleTint(theme, replyFromPeer)}
                style={{
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
            </GlassView>
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

function ReplyAttachment({ blockExternalGestures, reply, replyFromPeer, onReplyPress }) {
    const { theme } = useTheme();
    const title = getAttachmentTitle(reply);
    const caption = getAttachmentCaption(reply);

    return (
        <ReplyPressable blockExternalGestures={blockExternalGestures} onReplyPress={onReplyPress}>
            <GlassView
                glassEffectStyle="clear"
                tintColor={bubbleTint(theme, replyFromPeer)}
                style={{
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
            </GlassView>
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
            return <ReplyImage blockExternalGestures={blockExternalGestures} reply={reply} peerChatPK={peerChatPK} onReplyPress={onReplyPress} />;
        case 'file':
        case 'mp3':
        case 'mp4':
            return <ReplyAttachment blockExternalGestures={blockExternalGestures} reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        default:
            return null;
    }
}

export default function ReplyMessage({ msg, fromPeer = false, menuItems, menuId, reply, replyFromPeer = false, peerChatPK, peerDisplayName, onReplyPress, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const blockExternalGestures = useMessageGestureBlockers();
    const replyPreviewBlockers = useMessageGestureBlockers({ includeLike: true });
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
