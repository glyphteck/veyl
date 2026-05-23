import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { File } from 'lucide-react-native';
import { useChat } from '@/providers/chatprovider';
import { useTheme } from '@/providers/themeprovider';
import { warmMessageDownload } from '@/lib/chatdownloads';
import { bubbleTint } from '@/lib/messages';
import { formatAttachmentSize, getAttachmentCaption, getAttachmentTitle } from '@glyphteck/shared/chat/messages';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';

const ATTACHMENT_LONG_SCALE = 0.9;

export default function AttachmentMessage({ msg, peerChatPK, fromPeer = false, menuItems, menuId, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const { theme } = useTheme();
    const { readMessageFile } = useChat();
    const focused = useIsFocused();
    const title = getAttachmentTitle(msg);
    const caption = getAttachmentCaption(msg);
    const size = formatAttachmentSize(Number(msg?.z));

    useEffect(() => {
        if (!focused) {
            return;
        }
        void warmMessageDownload(msg, peerChatPK, readMessageFile);
    }, [focused, msg?.k, msg?.m, msg?.p, msg?.t, msg?.z, peerChatPK, readMessageFile]);

    return (
        <Menu id={menuId} items={menuItems} longScale={ATTACHMENT_LONG_SCALE} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer}>
                <GlassView
                    glassEffectStyle="clear"
                    tintColor={bubbleTint(theme, fromPeer)}
                    style={{
                        gap: 8,
                        maxWidth: 280,
                        borderRadius: 22,
                        paddingLeft: 14,
                        paddingRight: 20,
                        paddingVertical: 12,
                    }}
                >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Icon icon={File} color={theme.foreground} size={24} />
                        <View style={{ flexShrink: 1, gap: 2 }}>
                            <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 16, fontWeight: '900' }}>
                                {title}
                            </Text>
                            {size ? <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '600' }}>{size}</Text> : null}
                        </View>
                    </View>
                    {caption ? <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '500' }}>{caption}</Text> : null}
                </GlassView>
            </ReactionTray>
        </Menu>
    );
}
