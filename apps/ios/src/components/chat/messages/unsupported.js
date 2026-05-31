import { Text } from 'react-native';
import { useTheme } from '@/providers/themeprovider';
import { useMessageGestureBlockers } from '@/components/chat/messagegesturecontext';
import GlassView from '@/components/glass/glassview';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';

function UnsupportedBubble() {
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
                this message cannot be shown
            </Text>
        </GlassView>
    );
}

export default function UnsupportedMessage({ fromPeer = false, menuItems, menuId, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const blockExternalGestures = useMessageGestureBlockers();
    return (
        <Menu id={menuId} items={menuItems} blockExternalGestures={blockExternalGestures} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer}>
                <UnsupportedBubble />
            </ReactionTray>
        </Menu>
    );
}
