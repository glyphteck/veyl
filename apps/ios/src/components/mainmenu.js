import { useMemo } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera } from 'lucide-react-native';
import { isMainnet, resolveNetwork } from '@veyl/shared/network';
import Avatar from './avatar';
import { DotIcon, DOT_ICONS } from './dot';
import GlassView from './glass/glassview';
import Icon from './icon';
import { useTheme } from '../providers/themeprovider';
import { useUser } from '../providers/userprovider';
import { useChat } from '../providers/chatprovider';
import { alpha } from '@/lib/colors';
import { useTap } from '@/lib/tap';

const ICON_SIZE = 32;
const AVATAR_SIZE = 34;
const MENU_HEIGHT = 56;
const MENU_RADIUS = 999;
const MENU_WIDTH = '70%';
const MENU_MIN_WIDTH = 256;
const MENU_MAX_WIDTH = 320;
const MENU_BOTTOM_GAP = 10;
const MENU_TOP_RESERVE = 12;
const MENU_SIDE_PADDING = 6;
const ITEM_TOUCH_SIZE = 48;
const REGTEST_BOTTOM_GAP = 6;

function getMenuBottomOffset(bottomInset = 0) {
    return Math.max(MENU_BOTTOM_GAP, Number(bottomInset) || 0);
}

export function getMainMenuHeight(bottomInset = 0) {
    return MENU_HEIGHT + getMenuBottomOffset(bottomInset) + MENU_TOP_RESERVE;
}

const ITEM_STYLE = {
    width: ITEM_TOUCH_SIZE,
    height: ITEM_TOUCH_SIZE,
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

function MenuItem({ progress, onPress, onPressIn, disabled = false, pressScale = 1, children }) {
    const liveScale = useMemo(
        () =>
            progress.interpolate({
                inputRange: [0, 1],
                outputRange: [INACTIVE_SCALE, ACTIVE_SCALE],
                extrapolate: 'clamp',
            }),
        [progress]
    );
    const pressFeedback = useTap({ onPress, disabled, hapticIn: false, hapticOut: 'soft', scale: pressScale });
    const pressProps = {
        ...pressFeedback.props,
        onPressIn: (event) => {
            if (!disabled) onPressIn?.(event);
            pressFeedback.props.onPressIn?.(event);
        },
    };

    return (
        <Pressable {...pressProps} style={ITEM_STYLE} disabled={disabled}>
            <Animated.View style={{ opacity: disabled ? 0.45 : 1, transform: [{ scale: liveScale }, { scale: pressFeedback.scale }] }}>{children}</Animated.View>
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
    const chatActive = state.routes[state.index]?.name === 'chat';

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
            <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: getMenuBottomOffset(insets.bottom), alignItems: 'center' }}>
                <GlassView
                    glassEffectStyle="clear"
                    tintColor={theme.glassBackground}
                    style={{
                        width: MENU_WIDTH,
                        minWidth: MENU_MIN_WIDTH,
                        maxWidth: MENU_MAX_WIDTH,
                        height: MENU_HEIGHT,
                        borderRadius: MENU_RADIUS,
                        borderCurve: 'continuous',
                        overflow: 'hidden',
                    }}
                >
                    <View
                        style={{
                            flex: 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            paddingHorizontal: MENU_SIDE_PADDING,
                            paddingVertical: (MENU_HEIGHT - ITEM_TOUCH_SIZE) / 2,
                        }}
                    >
                        <MenuItem progress={tabProgress[routeIndexes.chat]} onPress={() => onSelect('chat')} onPressIn={() => warmRoute('chat')} disabled={chatBanned} pressScale={chatActive ? 0.86 : 1}>
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
                    </View>
                </GlassView>
            </View>
            {!isMainnet(network) ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: REGTEST_BOTTOM_GAP,
                        alignItems: 'center',
                    }}
                >
                    <View style={{ borderRadius: 999, backgroundColor: alpha(theme.destructive, 12), paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ color: theme.destructive, fontSize: 10, fontWeight: '900', lineHeight: 12 }}>regtest</Text>
                    </View>
                </View>
            ) : null}
        </>
    );
}
