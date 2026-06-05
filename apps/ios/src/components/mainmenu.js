import { useMemo } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera } from 'lucide-react-native';
import { isMainnet, resolveNetwork } from '@veyl/shared/network';
import Avatar from './avatar';
import { DotIcon, DOT_ICONS } from './dot';
import GlassFooter from './glass/glassfooter';
import Icon from './icon';
import { useTheme } from '../providers/themeprovider';
import { useUser } from '../providers/userprovider';
import { useChat } from '../providers/chatprovider';
import { alpha } from '@/lib/colors';
import { useTap } from '@/lib/tap';

const ICON_SIZE = 32;
const AVATAR_SIZE = 34;
const TOP_PADDING = 8;
const ITEM_HEIGHT = Math.max(ICON_SIZE, AVATAR_SIZE);
const HEIGHT = TOP_PADDING + ITEM_HEIGHT;

export function getMainMenuHeight(bottomInset = 0) {
    return HEIGHT + Math.max(0, Number(bottomInset) || 0);
}

const ITEM_STYLE = {
    flex: 1,
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
};
const ACTIVE_SCALE = 1;
const INACTIVE_SCALE = 0.82;
const network = resolveNetwork(globalThis?.process?.env ?? {});

function routeProgress(position, index) {
    return position.interpolate({
        inputRange: [index - 1, index, index + 1],
        outputRange: [0, 1, 0],
        extrapolate: 'clamp',
    });
}

function MenuItem({ progress, onPress, onPressIn, disabled = false, children }) {
    const liveScale = useMemo(
        () =>
            progress.interpolate({
                inputRange: [0, 1],
                outputRange: [INACTIVE_SCALE, ACTIVE_SCALE],
                extrapolate: 'clamp',
            }),
        [progress]
    );
    const pressFeedback = useTap({ onPress, disabled, hapticIn: false, hapticOut: 'soft', scale: 1 });
    const pressProps = {
        ...pressFeedback.props,
        onPressIn: (event) => {
            if (!disabled) onPressIn?.(event);
            pressFeedback.props.onPressIn?.(event);
        },
    };

    return (
        <Pressable {...pressProps} style={ITEM_STYLE} disabled={disabled}>
            <Animated.View style={{ opacity: disabled ? 0.45 : 1, transform: [{ scale: liveScale }] }}>{children}</Animated.View>
        </Pressable>
    );
}

export default function MainMenu({ state, navigation, position, onWarmRoute }) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { avatar, chatBanned } = useUser();
    const { chats } = useChat();
    const routeIndexes = useMemo(() => Object.fromEntries(state.routes.map((route, index) => [route.name, index])), [state.routes]);
    const tabProgress = useMemo(() => state.routes.map((_, index) => routeProgress(position, index)), [state.routes, position]);
    const hasUnseenChats = !!chats?.some((chat) => chat?.unseen);
    const showWalletDot = false;

    const warmRoute = (name) => {
        const index = routeIndexes[name];
        const route = state.routes[index];
        if (route) onWarmRoute?.(route.name);
    };

    const onSelect = (name) => {
        if (name === 'chat' && chatBanned) {
            return;
        }
        const index = routeIndexes[name];
        const route = state.routes[index];
        if (route) navigation.navigate(route.name);
    };

    return (
        <>
            <GlassFooter
                contentStyle={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    paddingTop: TOP_PADDING,
                }}
            >
                <MenuItem progress={tabProgress[routeIndexes.chat]} onPress={() => onSelect('chat')} onPressIn={() => warmRoute('chat')} disabled={chatBanned}>
                    <DotIcon iconNode={DOT_ICONS.messageCircle} show={!chatBanned && hasUnseenChats} color={chatBanned ? theme.muted : theme.foreground} size={ICON_SIZE} />
                </MenuItem>
                <MenuItem progress={tabProgress[routeIndexes.camera]} onPress={() => onSelect('camera')} onPressIn={() => warmRoute('camera')}>
                    <Icon icon={Camera} color={theme.foreground} size={ICON_SIZE} />
                </MenuItem>
                <MenuItem progress={tabProgress[routeIndexes.wallet]} onPress={() => onSelect('wallet')} onPressIn={() => warmRoute('wallet')}>
                    <DotIcon iconNode={DOT_ICONS.wallet} show={showWalletDot} color={theme.foreground} size={ICON_SIZE} />
                </MenuItem>
                <MenuItem progress={tabProgress[routeIndexes.settings]} onPress={() => onSelect('settings')} onPressIn={() => warmRoute('settings')}>
                    <View pointerEvents="none">
                        <Avatar size={AVATAR_SIZE} source={avatar ? { uri: avatar } : null} />
                    </View>
                </MenuItem>
            </GlassFooter>
            {!isMainnet(network) ? (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(6, Math.min(12, insets.bottom - 20)), alignItems: 'center' }}>
                    <View style={{ borderRadius: 999, backgroundColor: alpha(theme.destructive, 12), paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ color: theme.destructive, fontSize: 10, fontWeight: '900', lineHeight: 12 }}>regtest</Text>
                    </View>
                </View>
            ) : null}
        </>
    );
}
