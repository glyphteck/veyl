import { Text, View } from 'react-native';
import { useTheme } from '@/providers/themeprovider';
import { bubbleShadow } from '@/lib/chat/messages';
import { useGestureBlockers } from './gesturecontext';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';

function UnsupportedBubble() {
    const { theme } = useTheme();

    return (
        <View
            style={{
                backgroundColor: theme.destructive,
                ...bubbleShadow(theme),
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
        </View>
    );
}

export default function UnsupportedMessage({ fromPeer = false, menuItems, menuId, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const blockExternalGestures = useGestureBlockers();
    return (
        <Menu id={menuId} items={menuItems} blockExternalGestures={blockExternalGestures} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer}>
                <UnsupportedBubble />
            </ReactionTray>
        </Menu>
    );
}
