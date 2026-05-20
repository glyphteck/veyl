import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { File } from 'lucide-react-native';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { bubbleTint, imageWidth } from '@/lib/messages';
import { useMsgImage } from '@/lib/usemsgimage';
import { UNAVAILABLE_REPLY_MSG_TYPE, getAttachmentCaption, getAttachmentTitle, getImageAspect, makeUnavailableReply } from '@glyphteck/shared/chat/messages';
import { renderMoney } from '@glyphteck/shared/utils';
import GlassView from '@/components/glass/glassview';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';
import { TextBubble } from './text';

function ReplyPressable({ onReplyPress, children }) {
    return (
        <Pressable onPress={onReplyPress} style={{ maxWidth: '100%' }}>
            {children}
        </Pressable>
    );
}

function ReplyText({ reply, replyFromPeer, onReplyPress }) {
    return (
        <ReplyPressable onReplyPress={onReplyPress}>
            <TextBubble msg={reply} fromPeer={replyFromPeer} compact singleLine muted allowEmoji={false} />
        </ReplyPressable>
    );
}

function ReplyUnavailable({ reply, onReplyPress }) {
    const { theme } = useTheme();
    return (
        <ReplyPressable onReplyPress={onReplyPress}>
            <View
                style={{
                    maxWidth: '100%',
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    backgroundColor: theme.foreground,
                }}
            >
                <Text numberOfLines={1} style={{ color: theme.background, fontSize: 15, fontWeight: '600' }}>
                    {reply?.c}
                </Text>
            </View>
        </ReplyPressable>
    );
}

function ReplyRequest({ reply, replyFromPeer, peerDisplayName, onReplyPress }) {
    const { theme } = useTheme();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { getTxById } = useTxData();
    const msgTx = reply.tx ? getTxById?.(reply.tx) : null;
    const displayAmount = msgTx ? Math.abs(Number(msgTx.amount)) : Number(reply.a);
    const amount = renderMoney(displayAmount, settings?.moneyFormat, bitcoin?.price);
    const label = reply.tx ? (replyFromPeer ? 'You sent' : 'You received') : replyFromPeer ? `${peerDisplayName || 'They'} requested` : 'You requested';

    return (
        <ReplyPressable onReplyPress={onReplyPress}>
            <GlassView
                glassEffectStyle="clear"
                tintColor={bubbleTint(theme, replyFromPeer)}
                style={{
                    maxWidth: '100%',
                    borderRadius: 20,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    opacity: 0.65,
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

function ReplyImage({ reply, peerChatPK, onReplyPress }) {
    const { theme } = useTheme();
    const { source, loading } = useMsgImage(peerChatPK, reply, true);
    const aspect = getImageAspect(reply);
    const width = Math.round(Math.min(150, imageWidth(aspect) * 0.56));

    return (
        <ReplyPressable onReplyPress={onReplyPress}>
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

function ReplyAttachment({ reply, replyFromPeer, onReplyPress }) {
    const { theme } = useTheme();
    const title = getAttachmentTitle(reply);
    const caption = getAttachmentCaption(reply);

    return (
        <ReplyPressable onReplyPress={onReplyPress}>
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
                    opacity: 0.65,
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

function ReplyPreview({ reply, replyFromPeer, peerChatPK, peerDisplayName, onReplyPress }) {
    switch (reply?.t) {
        case UNAVAILABLE_REPLY_MSG_TYPE:
            return <ReplyUnavailable reply={reply} onReplyPress={onReplyPress} />;
        case 'txt':
            return <ReplyText reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        case 'req':
            return <ReplyRequest reply={reply} replyFromPeer={replyFromPeer} peerDisplayName={peerDisplayName} onReplyPress={onReplyPress} />;
        case 'img':
            return <ReplyImage reply={reply} peerChatPK={peerChatPK} onReplyPress={onReplyPress} />;
        case 'file':
        case 'mp3':
        case 'mp4':
            return <ReplyAttachment reply={reply} replyFromPeer={replyFromPeer} onReplyPress={onReplyPress} />;
        default:
            return null;
    }
}

export default function ReplyMessage({ msg, fromPeer = false, menuItems, menuId, reply, replyFromPeer = false, peerChatPK, peerDisplayName, onReplyPress, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const body = (
        <Menu id={menuId} items={menuItems} previewBottomInset={reactionPreviewInset}>
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
            <ReplyPreview reply={replyPreview} replyFromPeer={replyFromPeer} peerChatPK={peerChatPK} peerDisplayName={peerDisplayName} onReplyPress={onReplyPress} />
            <View style={{ maxWidth: '100%' }}>
                {body}
            </View>
        </View>
    );
}
