import { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ArrowUpRight } from 'lucide-react-native';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { bubbleStyle } from '@/lib/chat/messages';
import { getRequestContext } from '@veyl/shared/chat/messages';
import { useGestureBlockers } from './gesturecontext';
import GlassView from '@/components/glass/glassview';
import Icon from '@/components/icon';
import { disabledGlassTint } from '@/lib/colors';
import { resolveGlassEffectStyle } from '@/lib/glass';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';

const CARD = { borderRadius: 22, paddingTop: 12, paddingBottom: 6, paddingHorizontal: 16 };
const LABEL = { fontSize: 16, fontWeight: '600' };
const AMOUNT = { fontSize: 38, fontWeight: '900' };
const ROW = { flexDirection: 'row', alignItems: 'center', gap: 22 };
const LABEL_ROW = { flexDirection: 'row', alignItems: 'center', gap: 6 };
const PAY_ICON_SIZE = 56;
const PAY_ICON_SYMBOL_SIZE = 32;
const PAY_ICON_SCALE = 0.9;
const PAY_ICON_TAP_MAX_DURATION_MS = 240;
const PAY_ICON_TAP_MAX_DISTANCE = 18;
const PAY_ICON_GLASS = resolveGlassEffectStyle();
const PAY_ICON_SPRING = {
    mass: 0.5,
    stiffness: 350,
    damping: 18,
};

function PayButton({ blockExternalGestures, disabled = false, onPress }) {
    const { theme } = useTheme();
    const scale = useSharedValue(1);
    const latestRef = useRef({ disabled, onPress });

    latestRef.current = { disabled, onPress };

    const press = useCallback(() => {
        const latest = latestRef.current;
        if (latest.disabled || typeof latest.onPress !== 'function') {
            return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
        latest.onPress();
    }, []);

    const gesture = useMemo(() => {
        let next = Gesture.Tap()
            .enabled(!disabled)
            .maxDuration(PAY_ICON_TAP_MAX_DURATION_MS)
            .maxDistance(PAY_ICON_TAP_MAX_DISTANCE)
            .hitSlop(10)
            .onTouchesDown(() => {
                'worklet';
                scale.value = withSpring(PAY_ICON_SCALE, PAY_ICON_SPRING);
            })
            .onFinalize(() => {
                'worklet';
                scale.value = withSpring(1, PAY_ICON_SPRING);
            })
            .onEnd((_event, success) => {
                'worklet';
                if (success) {
                    scheduleOnRN(press);
                }
            });
        if (blockExternalGestures?.length) {
            next = next.blocksExternalGesture(...blockExternalGestures);
        }
        return next;
    }, [blockExternalGestures, disabled, press, scale]);
    const style = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));
    const color = disabled ? theme.muted : theme.background;
    const tintColor = disabled ? disabledGlassTint(theme) : theme.glassForeground;
    const inset = Math.max(0, (PAY_ICON_SIZE - PAY_ICON_SYMBOL_SIZE) / 2);

    return (
        <GestureDetector gesture={gesture}>
            <Animated.View accessible accessibilityRole="button" accessibilityState={{ disabled }} onAccessibilityTap={press} style={[{ width: PAY_ICON_SIZE, height: PAY_ICON_SIZE, borderRadius: 99, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>
                <GlassView glassEffectStyle={PAY_ICON_GLASS} tintColor={tintColor} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 99 }}>
                    <Icon icon={ArrowUpRight} size={PAY_ICON_SYMBOL_SIZE} color={color} style={{ margin: inset }} />
                </GlassView>
            </Animated.View>
        </GestureDetector>
    );
}

function RequestCard({ fromPeer = false, formattedAmount, label, amountColor, isPaying = false, theme }) {
    if (fromPeer) {
        return (
            <View style={[bubbleStyle(theme, fromPeer), CARD]}>
                <View style={LABEL_ROW}>
                    <Text style={[LABEL, { color: theme.muted }]}>{label}</Text>
                    {isPaying ? <ActivityIndicator color={theme.muted} size="small" /> : null}
                </View>
                <Text style={[AMOUNT, { color: amountColor }]}>{formattedAmount}</Text>
            </View>
        );
    }

    return (
        <View style={[bubbleStyle(theme, fromPeer), CARD, { alignItems: 'flex-end' }]}>
            <Text style={[LABEL, { color: theme.muted }]}>{label}</Text>
            <Text style={[AMOUNT, { color: amountColor }]}>{formattedAmount}</Text>
        </View>
    );
}

function RequestBubble({ card, menuId, menuItems, onHold, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const blockExternalGestures = useGestureBlockers();
    return (
        <Menu id={menuId} items={menuItems} onHold={onHold} blockExternalGestures={blockExternalGestures} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={card?.fromPeer}>
                <RequestCard {...card} />
            </ReactionTray>
        </Menu>
    );
}

export default function RequestMessage({ msg, fromPeer = false, peerDisplayName, onPay, isPaying = false, menuId, menuItems, onHold, reactions = [], reactionUsers, reactionPreviewInset = 0 }) {
    const { theme } = useTheme();
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { balance } = useWallet();
    const { getTxById } = useTxData();
    const { amount: formattedAmount, label, tx: msgTx } = getRequestContext(msg, { fromPeer, peerDisplayName, moneyFormat: settings?.moneyFormat, btcPrice: bitcoin?.price, getTxById });
    const isTransactionPending = msg.tx && (!msgTx || msgTx.pending !== false);
    const cardLabel = isPaying ? 'sending' : label;
    const amountColor = !msg.tx ? theme.foreground : fromPeer ? (isTransactionPending ? `${theme.outflow}80` : theme.outflow) : isTransactionPending ? `${theme.inflow}80` : theme.inflow;
    const card = { fromPeer, formattedAmount, label: cardLabel, amountColor, isPaying, theme };
    const payBlockers = useGestureBlockers({ includeLike: true });

    if (fromPeer) {
        const canAfford = balance != null && Number(msg.a) <= balance;

        return (
            <View style={ROW}>
                <RequestBubble card={card} menuId={menuId} menuItems={menuItems} onHold={onHold} reactions={reactions} reactionUsers={reactionUsers} reactionPreviewInset={reactionPreviewInset} />
                {!msg.tx && !isPaying ? <PayButton blockExternalGestures={payBlockers} onPress={onPay} disabled={!canAfford} /> : null}
            </View>
        );
    }

    return <RequestBubble card={card} menuId={menuId} menuItems={menuItems} onHold={onHold} reactions={reactions} reactionUsers={reactionUsers} reactionPreviewInset={reactionPreviewInset} />;
}
