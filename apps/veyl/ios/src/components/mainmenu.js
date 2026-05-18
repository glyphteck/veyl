import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera } from 'lucide-react-native';
import { isMainnet, resolveNetwork } from '@glyphteck/shared/network';
import Avatar from './avatar';
import { DotIcon, DOT_ICONS } from './dot';
import GlassFooter from './glass/glassfooter';
import Icon from './icon';
import { useTheme } from '../providers/themeprovider';
import { useUser } from '../providers/userprovider';
import { useChat } from '../providers/chatprovider';
import { alpha } from '@/lib/colors';
import { useTap } from '@/lib/tap';
import { warmCamera } from '@/lib/camerawarm';

const ITEM_STYLE = {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
};
const ACTIVE_SCALE = 1;
const INACTIVE_SCALE = 0.82;
const network = resolveNetwork(globalThis?.process?.env ?? {});

function MenuItem({ active, onPress, onPressIn, disabled = false, children }) {
    const activeScale = useRef(new Animated.Value(active ? ACTIVE_SCALE : INACTIVE_SCALE)).current;
    const pressFeedback = useTap({ onPress, disabled, hapticIn: 'light' });
    const pressProps = {
        ...pressFeedback.props,
        onPressIn: (event) => {
            if (!disabled) onPressIn?.(event);
            pressFeedback.props.onPressIn?.(event);
        },
    };

    useEffect(() => {
        Animated.spring(activeScale, {
            toValue: active ? ACTIVE_SCALE : INACTIVE_SCALE,
            useNativeDriver: true,
            speed: 24,
            bounciness: 12,
        }).start();
    }, [active, activeScale]);

    return (
        <Pressable {...pressProps} style={ITEM_STYLE} disabled={disabled}>
            <Animated.View style={{ opacity: disabled ? 0.45 : 1, transform: [{ scale: Animated.multiply(activeScale, pressFeedback.scale) }] }}>{children}</Animated.View>
        </Pressable>
    );
}

export default function MainMenu({ state, navigation }) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { avatar, chatBanned } = useUser();
    const { chats } = useChat();
    const pageIndex = state?.index ?? 0;
    const iconSize = 32;
    const avatarSize = 34;
    const hasUnseenChats = !!chats?.some((chat) => chat?.unseen);
    const showWalletDot = false;

    const onSelect = (index) => {
        if (index === 0 && chatBanned) {
            return;
        }
        const route = state.routes[index];
        navigation.navigate(route.name);
    };

    return (
        <>
            <GlassFooter
                contentStyle={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                }}
            >
                <MenuItem active={pageIndex === 0} onPress={() => onSelect(0)} disabled={chatBanned}>
                    <DotIcon iconNode={DOT_ICONS.messageCircle} show={!chatBanned && hasUnseenChats} color={chatBanned ? theme.muted : theme.foreground} size={iconSize} />
                </MenuItem>
                <MenuItem active={pageIndex === 1} onPress={() => onSelect(1)} onPressIn={warmCamera}>
                    <Icon icon={Camera} color={theme.foreground} size={iconSize} />
                </MenuItem>
                <MenuItem active={pageIndex === 2} onPress={() => onSelect(2)}>
                    <DotIcon iconNode={DOT_ICONS.wallet} show={showWalletDot} color={theme.foreground} size={iconSize} />
                </MenuItem>
                <MenuItem active={pageIndex === 3} onPress={() => onSelect(3)}>
                    <View pointerEvents="none">
                        <Avatar size={avatarSize} source={avatar ? { uri: avatar } : null} />
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
