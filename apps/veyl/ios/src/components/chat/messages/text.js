import { Linking, Text, View } from 'react-native';
import { useTheme } from '@/providers/themeprovider';
import { bubbleTint } from '@/lib/messages';
import { getEmojiTextInfo } from '@glyphteck/shared/utils';
import { splitLinks } from '@glyphteck/shared/chat/messages';
import GlassView from '@/components/glass/glassview';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';

const EMOJI_LINE_HEIGHT = 1.1;

export function TextBubble({ msg, fromPeer = false, compact = false, singleLine = false, muted = false, allowEmoji = true }) {
    const { theme } = useTheme();
    const text = typeof msg?.c === 'string' ? msg.c : '';
    const emoji = getEmojiTextInfo(text);

    if (allowEmoji && emoji && !compact) {
        const lineHeight = Math.ceil(emoji.size * EMOJI_LINE_HEIGHT);

        return (
            <View style={{ paddingHorizontal: 2 }}>
                <Text style={{ fontSize: emoji.size, lineHeight, includeFontPadding: false, color: theme.foreground }}>{emoji.text}</Text>
            </View>
        );
    }
    const parts = splitLinks(text);

    return (
        <GlassView
            glassEffectStyle="clear"
            tintColor={bubbleTint(theme, fromPeer)}
            style={{
                maxWidth: '100%',
                borderRadius: compact ? 20 : 22,
                paddingHorizontal: compact ? 10 : 14,
                paddingVertical: compact ? 7 : 10,
                opacity: muted ? 0.65 : 1,
            }}
        >
            <Text numberOfLines={singleLine ? 1 : undefined} style={{ fontSize: compact ? 15 : 16, fontWeight: '500', color: theme.foreground }}>
                {parts.map((part, index) =>
                    part.t === 'lnk' ? (
                        <Text key={`${part.u}:${index}`} style={{ color: theme.foreground, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(part.u).catch((error) => console.warn('open link failed', error))}>
                            {part.c}
                        </Text>
                    ) : (
                        <Text key={index}>{part.c}</Text>
                    )
                )}
            </Text>
        </GlassView>
    );
}

export default function TextMessage({ msg, fromPeer = false, menuItems, menuId, reaction, reactionActive = false, reactionPreviewInset = 0 }) {
    return (
        <Menu id={menuId} items={menuItems} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reaction={reaction} active={reactionActive}>
                <TextBubble msg={msg} fromPeer={fromPeer} />
            </ReactionTray>
        </Menu>
    );
}
