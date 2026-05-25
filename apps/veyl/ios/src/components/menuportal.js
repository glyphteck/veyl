import { Animated as RNAnimated, Pressable, ScrollView, Text, View } from 'react-native';
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

function clamp(value, min, max) {
    if (max < min) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}

function makeMenuPosition({ left, top, height, placement }) {
    return { left, top, width: WIDTH, maxHeight: height, placement };
}

export function getMenuPosition(anchor, count, insets, screenW, screenH) {
    if (!anchor || !count || !screenW || !screenH) return null;

    const menuH = LIST_PAD * 2 + count * ROW_H + Math.max(count - 1, 0);
    const safeLeft = EDGE;
    const safeRight = screenW - EDGE;
    const safeTop = insets.top + EDGE;
    const safeBottom = screenH - insets.bottom - EDGE;
    const safeHeight = Math.max(0, safeBottom - safeTop);
    const minMenuH = Math.min(menuH, LIST_PAD * 2 + ROW_H);
    const anchorCenterX = anchor.x + anchor.width / 2;
    const anchorCenterY = anchor.y + anchor.height / 2;
    const centeredLeft = clamp(anchorCenterX - WIDTH / 2, safeLeft, safeRight - WIDTH);
    const aboveSpace = anchor.y - MENU_GAP - safeTop;
    const belowTop = anchor.y + anchor.height + MENU_GAP;
    const belowSpace = safeBottom - belowTop;
    const candidates = [];

    if (aboveSpace >= menuH) {
        candidates.push(makeMenuPosition({ left: centeredLeft, top: anchor.y - MENU_GAP - menuH, height: menuH, placement: 'above' }));
    }
    if (belowSpace >= menuH) {
        candidates.push(makeMenuPosition({ left: centeredLeft, top: belowTop, height: menuH, placement: 'below' }));
    }

    const sideHeight = Math.min(menuH, safeHeight);
    const sideTop = clamp(anchorCenterY - sideHeight / 2, safeTop, safeBottom - sideHeight);
    const leftSpace = anchor.x - MENU_GAP - safeLeft;
    const rightSpace = safeRight - (anchor.x + anchor.width + MENU_GAP);
    const sideCandidates = [];

    if (leftSpace >= WIDTH) {
        sideCandidates.push(makeMenuPosition({ left: anchor.x - MENU_GAP - WIDTH, top: sideTop, height: sideHeight, placement: 'left' }));
    }
    if (rightSpace >= WIDTH) {
        sideCandidates.push(makeMenuPosition({ left: anchor.x + anchor.width + MENU_GAP, top: sideTop, height: sideHeight, placement: 'right' }));
    }
    sideCandidates.sort((a, b) => {
        const aSpace = a.placement === 'left' ? leftSpace : rightSpace;
        const bSpace = b.placement === 'left' ? leftSpace : rightSpace;
        return bSpace - aSpace;
    });
    candidates.push(...sideCandidates);

    if (aboveSpace >= minMenuH) {
        const height = Math.min(menuH, aboveSpace);
        candidates.push(makeMenuPosition({ left: centeredLeft, top: anchor.y - MENU_GAP - height, height, placement: 'above' }));
    }
    if (belowSpace >= minMenuH) {
        const height = Math.min(menuH, belowSpace);
        candidates.push(makeMenuPosition({ left: centeredLeft, top: belowTop, height, placement: 'below' }));
    }

    if (candidates.length) {
        return candidates[0];
    }

    if (aboveSpace >= belowSpace && aboveSpace > 0) {
        const height = Math.min(menuH, aboveSpace);
        return makeMenuPosition({ left: centeredLeft, top: anchor.y - MENU_GAP - height, height, placement: 'above' });
    }
    if (belowSpace > 0) {
        const height = Math.min(menuH, belowSpace);
        return makeMenuPosition({ left: centeredLeft, top: belowTop, height, placement: 'below' });
    }

    return makeMenuPosition({ left: centeredLeft, top: safeTop, height: Math.min(menuH, safeHeight), placement: 'screen' });
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
                    maxHeight: pos.maxHeight,
                    zIndex: 42,
                    transform: [{ scale: menuScale }],
                }}
            >
                <GlassView glassEffectStyle="clear" tintColor={theme.background} style={{ borderRadius: 22, paddingVertical: 2, maxHeight: pos.maxHeight, overflow: 'hidden' }}>
                    <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
                        {menu.items.map((item) => (
                            <MenuRow key={item.id} item={item} theme={theme} onPress={() => onRunItem(item)} />
                        ))}
                    </ScrollView>
                </GlassView>
            </RNAnimated.View>
        </View>
    );
}
