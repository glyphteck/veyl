import { Text } from 'react-native';
import { useTheme } from '@/providers/themeprovider';
import GlassView from '@/components/glass/glassview';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';

function UnsupportedBubble({ msg }) {
    const { theme } = useTheme();

    return (
        <GlassView
            glassEffectStyle="clear"
            tintColor={theme.destructive}
            style={{
                borderRadius: 22,
                paddingHorizontal: 14,
                paddingVertical: 10,
            }}
        >
            <Text
                style={{
                    fontSize: 16,
                    fontWeight: '500',
                    color: theme.background,
                }}
            >
                [unsupported message type]: {'\n'} {msg?.c}
            </Text>
        </GlassView>
    );
}

export default function UnsupportedMessage({ msg, menuItems, menuId, reaction, reactionActive = false, reactionPreviewInset = 0 }) {
    return (
        <Menu id={menuId} items={menuItems} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reaction={reaction} active={reactionActive}>
                <UnsupportedBubble msg={msg} />
            </ReactionTray>
        </Menu>
    );
}
