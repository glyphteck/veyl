import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, InteractionManager, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import { BanknoteArrowDown, BanknoteArrowUp, UserRoundPlus } from 'lucide-react-native';

import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useWallet } from '@/providers/walletprovider';
import { useUser } from '@/providers/userprovider';
import { useTxData } from '@/providers/txdataprovider';
import { usePeer } from '@/providers/peerprovider';
import { useChat } from '@/providers/chatprovider';

import Avatar from '@/components/avatar';
import GlassHeader from '@/components/glass/glassheader';
import GlassIcon from '@/components/glass/glassicon';
import { useTap } from '@/lib/tap';
import { getChatId } from '@glyphteck/shared/crypto/chat';
import { formatFullDateTime, formatUserDisplay, renderBalance, renderMoney } from '@glyphteck/shared/utils';

const BALANCE_HEIGHT = 42;
const ACTIONS_HEIGHT = 72;
const ACTION_ICON_SIZE = 56;
const ACTION_GAP = 24;
const ACTION_COLLAPSE_OFFSET = (ACTION_ICON_SIZE + ACTION_GAP) / 2;
const PEER_SELECTOR_LOCK_MS = 520;

function TxRow({ tx, profile, theme, moneyFormat, btcPrice, isLast, openRoute, selectChat, user }) {
    const { chatPK, chatBanned } = user || {};
    const isInflow = (tx?.amount ?? 0) > 0;
    const amountText = renderMoney(tx?.totalValue ?? 0, moneyFormat, btcPrice, isInflow ? '+' : '-');

    const label = tx?.pending ? 'pending' : formatFullDateTime(tx?.createdTime);
    const displayName = tx?.funding ? 'Funded' : tx?.withdrawal ? 'Withdrawn' : formatUserDisplay({ username: profile?.username, walletPK: tx?.peerPK });

    const avatarSource = tx?.funding || tx?.withdrawal ? (user?.avatar ? { uri: user.avatar } : null) : profile?.avatar ? { uri: profile.avatar } : null;
    const isActive = tx?.funding || tx?.withdrawal ? false : !!profile?.active;
    const nameColor = tx?.funding ? theme.inflow : tx?.withdrawal ? theme.outflow : theme.foreground;
    const nameWeight = tx?.funding || tx?.withdrawal ? '900' : '700';
    const canOpen = !!tx?.funding || !!tx?.withdrawal || (!chatBanned && !!chatPK && !!profile?.chatPK);

    const openRow = useCallback(() => {
        if (tx?.funding || tx?.withdrawal) {
            openRoute('/settings', 'navigate');
            return;
        }
        if (!chatPK || !profile?.chatPK) return;

        const chatId = getChatId(chatPK, profile.chatPK);
        selectChat?.(chatId);
        openRoute({ pathname: '/chat/[peerchatpk]', params: { peerchatpk: profile.chatPK } });
    }, [chatPK, openRoute, profile?.chatPK, selectChat, tx?.funding, tx?.withdrawal]);

    const pressFeedback = useTap({
        disabled: !canOpen,
        onPress: openRow,
        hapticIn: false,
        hapticOut: false,
        hapticPress: 'soft',
        drift: 1,
    });

    return (
        <Pressable
            {...pressFeedback.props}
            disabled={!canOpen}
            delayPressIn={80}
            style={{
                paddingVertical: 10,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                borderBottomWidth: isLast ? 0 : 1,
                borderBottomColor: theme.border,
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flex: 1 }}>
                <Animated.View style={{ transform: [{ scale: pressFeedback.scale }] }} pointerEvents="none">
                    <Avatar pointerEvents="none" source={avatarSource} active={isActive} bot={!tx?.funding && !tx?.withdrawal && !!profile?.bot} />
                </Animated.View>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: nameWeight, color: nameColor }}>
                    {displayName}
                </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
                <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: theme.muted }}>
                    {label}
                </Text>
                <Text
                    numberOfLines={1}
                    style={{
                        marginTop: 2,
                        fontSize: 14,
                        fontWeight: '900',
                        color: isInflow ? theme.inflow : theme.outflow,
                        opacity: tx?.pending ? 0.5 : 1,
                    }}
                >
                    {amountText}
                </Text>
            </View>
        </Pressable>
    );
}

function WalletEmpty() {
    const { theme } = useTheme();

    return (
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 16 }}>
            <Text style={{ textAlign: 'center', fontSize: 24, fontWeight: '900', color: theme.foreground }}>no transactions yet</Text>
            <Text style={{ marginTop: 10, textAlign: 'center', fontSize: 16, lineHeight: 22, fontWeight: '700', color: theme.muted }}>
                Start by funding your wallet, or ask a friend to send you some sats.
            </Text>
        </View>
    );
}

function WalletLoading() {
    const { theme } = useTheme();

    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 16 }}>
            <ActivityIndicator color={theme.foreground} />
            <Text style={{ marginTop: 12, textAlign: 'center', fontSize: 16, fontWeight: '800', color: theme.muted }}>loading wallet...</Text>
        </View>
    );
}

export default function Wallet() {
    const { theme } = useTheme();
    const router = useRouter();
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    const bitcoin = useBitcoin();
    const { balance, txReady } = useWallet();
    const user = useUser();
    const { settings, chatBanned } = user || {};
    const { peerByWalletPK } = usePeer() || {};
    const { selectChat } = useChat() || {};
    const txData = useTxData();
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);

    const btcPrice = bitcoin?.price ?? 100000;
    const moneyFormat = settings?.moneyFormat ?? 'usd';

    const [displayFormat, setDisplayFormat] = useState(null);
    const activeFormat = displayFormat ?? moneyFormat;
    const showBalance = Number(balance ?? 0) > 0;
    const canWithdraw = showBalance;
    const [displayBalance, setDisplayBalance] = useState(showBalance ? balance : null);
    const fundedAnim = useRef(new Animated.Value(showBalance ? 1 : 0)).current;
    const balanceScale = fundedAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.001, 1],
        extrapolate: 'clamp',
    });
    const fundOffset = fundedAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [ACTION_COLLAPSE_OFFSET, 0],
        extrapolate: 'clamp',
    });
    const peerOffset = fundedAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-ACTION_COLLAPSE_OFFSET, 0],
        extrapolate: 'clamp',
    });
    const headerOffset = fundedAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-BALANCE_HEIGHT, 0],
    });
    const listOffset = fundedAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, BALANCE_HEIGHT],
        extrapolate: 'clamp',
    });
    const listTopSpace = insets.top + ACTIONS_HEIGHT;
    const cycleFormat = useCallback(() => {
        const abs = Math.abs(Number(balance ?? 0));
        const cycle = abs < 1_000_000 ? ['sats', 'usd'] : ['sats', 'usd', 'btc'];
        const idx = cycle.indexOf(activeFormat);
        setDisplayFormat(cycle[(idx + 1) % cycle.length]);
    }, [activeFormat, balance]);
    const balanceFeedback = useTap({ onPress: cycleFormat, disabled: !showBalance });

    const recentTxs = useMemo(() => (txData?.sortedTransactions ?? []).slice(0, 25), [txData?.sortedTransactions]);

    const balanceText = useMemo(() => {
        if (displayBalance == null) return '';
        return renderBalance(displayBalance, activeFormat, btcPrice);
    }, [displayBalance, activeFormat, btcPrice]);

    const lockRoute = useCallback((ms = 1200) => {
        if (routeLockRef.current) return false;
        routeLockRef.current = true;
        if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        routeLockTimerRef.current = setTimeout(() => {
            routeLockRef.current = false;
            routeLockTimerRef.current = null;
        }, ms);
        return true;
    }, []);

    useEffect(() => {
        return () => {
            if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        };
    }, []);

    useEffect(() => {
        if (!isFocused || chatBanned) return;

        const task = InteractionManager.runAfterInteractions(() => {
            router.prefetch('/peerselector');
        });

        return () => task.cancel?.();
    }, [chatBanned, isFocused, router]);

    useEffect(() => {
        if (showBalance) {
            setDisplayBalance(balance);
        }

        if (showBalance) {
            Animated.spring(fundedAnim, {
                toValue: 1,
                useNativeDriver: true,
                speed: 18,
                bounciness: 8,
            }).start();
            return;
        }

        Animated.spring(fundedAnim, {
            toValue: 0,
            useNativeDriver: true,
            speed: 22,
            bounciness: 10,
        }).start();
    }, [balance, fundedAnim, showBalance]);

    const openRoute = useCallback(
        (href, mode = 'push', lockMs = 1200) => {
            if (!lockRoute(lockMs)) return;
            if (mode === 'navigate') {
                router.navigate(href);
                return;
            }
            router.push(href);
        },
        [lockRoute, router]
    );

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <Animated.View style={{ flex: 1, transform: [{ translateY: listOffset }] }}>
                <FlatList
                    data={recentTxs}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item, index }) => (
                        <TxRow
                            tx={item}
                            profile={item?.peerPK ? peerByWalletPK?.get(item.peerPK) : null}
                            theme={theme}
                            moneyFormat={moneyFormat}
                            btcPrice={btcPrice}
                            isLast={index === recentTxs.length - 1}
                            openRoute={openRoute}
                            selectChat={selectChat}
                            user={user}
                        />
                    )}
                    ListHeaderComponent={<View style={{ height: listTopSpace }} />}
                    ListEmptyComponent={() => (txReady ? <WalletEmpty /> : <WalletLoading />)}
                    contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 56 + BALANCE_HEIGHT }}
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                    directionalLockEnabled
                    alwaysBounceHorizontal={false}
                />
            </Animated.View>

            <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + ACTIONS_HEIGHT + BALANCE_HEIGHT, transform: [{ translateY: headerOffset }] }}>
                <GlassHeader style={{ height: insets.top + ACTIONS_HEIGHT + BALANCE_HEIGHT, overflow: 'hidden' }}>
                    <View style={{ height: BALANCE_HEIGHT, overflow: 'hidden', justifyContent: 'center' }}>
                        <Pressable {...balanceFeedback.props} disabled={!showBalance} style={{ alignSelf: 'center', height: BALANCE_HEIGHT, justifyContent: 'center' }}>
                            <Animated.View style={{ transform: [{ scale: balanceScale }] }}>
                                <Animated.View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', transform: [{ scale: balanceFeedback.scale }] }}>
                                    <Text style={{ fontSize: 40, fontWeight: '900', color: theme.foreground }}>{balanceText}</Text>
                                </Animated.View>
                            </Animated.View>
                        </Pressable>
                    </View>

                    <View style={{ width: ACTION_ICON_SIZE * 3 + ACTION_GAP * 2, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 4, overflow: 'visible' }}>
                        <Animated.View style={{ transform: [{ translateX: fundOffset }] }}>
                            <GlassIcon glassEffectStyle="regular" rounded={16} icon={BanknoteArrowDown} onPress={() => openRoute('/fundwallet')} />
                        </Animated.View>
                        <View style={{ width: ACTION_GAP }} />
                        <Animated.View pointerEvents={canWithdraw ? 'auto' : 'none'} style={{ transform: [{ scale: balanceScale }] }}>
                            <GlassIcon glassEffectStyle="regular" rounded={16} icon={BanknoteArrowUp} onPress={() => canWithdraw && openRoute('/withdraw')} disabled={!canWithdraw} visible={canWithdraw} />
                        </Animated.View>
                        <View style={{ width: ACTION_GAP }} />
                        <Animated.View style={{ transform: [{ translateX: peerOffset }] }}>
                            <GlassIcon glassEffectStyle="regular" rounded={16} icon={UserRoundPlus} onPress={() => openRoute('/peerselector', 'push', PEER_SELECTOR_LOCK_MS)} disabled={chatBanned} />
                        </Animated.View>
                    </View>
                </GlassHeader>
            </Animated.View>
        </View>
    );
}
