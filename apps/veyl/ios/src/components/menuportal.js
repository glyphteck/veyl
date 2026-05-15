import { Animated as RNAnimated, Pressable, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/providers/themeprovider';
import { useTap } from '@/lib/tap';
import { alpha } from '@/lib/colors';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';

const PAD = 16;
const WIDTH = 228;
const ROW_H = 48;
const LIST_PAD = 8;
const EDGE = PAD;
const MENU_GAP = 8;

export function getMenuPosition(anchor, count, insets, screenW, screenH) {
    if (!anchor || !count || !screenW || !screenH) return null;

    const menuH = LIST_PAD * 2 + count * ROW_H + Math.max(count - 1, 0);
    const minX = EDGE;
    const maxX = screenW - EDGE - WIDTH;
    const minY = insets.top + EDGE;
    const maxBottom = screenH - insets.bottom - EDGE;
    const maxY = maxBottom - menuH;

    let left = anchor.x + anchor.width / 2 - WIDTH / 2;
    left = Math.min(Math.max(left, minX), Math.max(minX, maxX));

    const above = anchor.y - menuH - MENU_GAP;
    const below = anchor.y + anchor.height + MENU_GAP;
    const fitsAbove = above >= minY;
    const fitsBelow = below + menuH <= maxBottom;
    const top = fitsAbove || !fitsBelow ? Math.min(Math.max(above, minY), Math.max(minY, maxY)) : below;

    return { left, top, width: WIDTH };
}

function MenuRow({ item, theme, onPress }) {
    const press = useTap({ disabled: !!item?.disabled, onPress, hapticIn: false, hapticOut: false, hapticPress: 'soft' });
    const color = item?.destructive ? theme.destructive : theme.foreground;

    return (
        <View>
            <Pressable {...press.props} disabled={!!item?.disabled} style={{ paddingLeft: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <RNAnimated.View style={{ transform: [{ scale: press.scale }] }}>
                    <Icon icon={item.icon} color={color} />
                </RNAnimated.View>
                <Text style={{ flex: 1, color, fontSize: 18, fontWeight: '900' }}>{item.title}</Text>
            </Pressable>
        </View>
    );
}

function Preview({ menu }) {
    if (!menu?.anchor || typeof menu.render !== 'function') {
        return null;
    }

    return (
        <RNAnimated.View
            collapsable={false}
            style={{
                position: 'absolute',
                left: menu.anchor.x,
                top: menu.anchor.y,
                width: menu.anchor.width,
                minHeight: menu.anchor.height,
                zIndex: 41,
            }}
        >
            {menu.render()}
        </RNAnimated.View>
    );
}

export function MenuPortal({ menu, pos, backdropOpacity, menuScale, onClose, onRunItem }) {
    const { theme } = useTheme();

    if (!menu || !pos) {
        return null;
    }

    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 40 }}>
            <Pressable onPress={onClose} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
                <RNAnimated.View style={{ flex: 1, opacity: backdropOpacity }}>
                    <BlurView tint="default" intensity={88} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
                    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: alpha(theme.background, 22) }} />
                </RNAnimated.View>
            </Pressable>
            <Preview menu={menu} />
            <RNAnimated.View
                style={{
                    position: 'absolute',
                    left: pos.left,
                    top: pos.top,
                    width: pos.width,
                    zIndex: 42,
                    transform: [{ scale: menuScale }],
                }}
            >
                <GlassView glassEffectStyle="clear" tintColor={theme.background} style={{ borderRadius: 22, paddingVertical: 2, overflow: 'hidden' }}>
                    {menu.items.map((item) => (
                        <MenuRow key={item.id} item={item} theme={theme} onPress={() => onRunItem(item)} />
                    ))}
                </GlassView>
            </RNAnimated.View>
        </View>
    );
}
