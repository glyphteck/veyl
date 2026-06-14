import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BanknoteArrowDown, BanknoteArrowUp, UserRoundPlus } from 'lucide-react-native';

import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { useWallet } from '@/providers/walletprovider';
import { useUser } from '@/providers/userprovider';
import { useTxData } from '@/providers/txdataprovider';
import { usePeer } from '@/providers/peerprovider';
import { useChat } from '@/providers/chatprovider';

import Avatar from '@/components/avatar';
import { FLOATING_HEADER_SCROLL_EDGE_PAD } from '@/components/floatingheader';
import GlassIcon from '@/components/glass/glassicon';
import { getMainMenuHeight } from '@/components/mainmenu';
import { useRouteLock } from '@/lib/navigation/routelock';
import { ScrollEdgeScreen } from '@/lib/navigation/scrolledge';
import { useTap } from '@/lib/tap';
import { BTC_PRICE_FALLBACK } from '@veyl/shared/config';
import { renderBalance, renderMoney } from '@veyl/shared/money';
import { formatUserDisplay } from '@veyl/shared/profile';
import { formatRowDateTime } from '@veyl/shared/utils/time';
import { useRowDateTimeNow } from '@veyl/shared/utils/userowdatetime';
import { hasAvailableBalance } from '@veyl/shared/wallet/balance';

const BALANCE_HEIGHT = 42;
const ACTIONS_HEIGHT = 76;
const ACTION_ICON_SIZE = 56;
const ACTION_GAP = 24;
const ACTION_COLLAPSE_OFFSET = (ACTION_ICON_SIZE + ACTION_GAP) / 2;
const PEER_SELECTOR_LOCK_MS = 520;
const TX_ROW_HEIGHT = 71;
const TX_ROW_SEPARATOR_HEIGHT = 1;
const TX_ROW_CONTENT_HEIGHT = TX_ROW_HEIGHT - TX_ROW_SEPARATOR_HEIGHT;

function sameTxRow(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
        a.id === b.id &&
        a.pending === b.pending &&
        a.amount === b.amount &&
        a.totalValue === b.totalValue &&
        a.createdMs === b.createdMs &&
        a.peerPK === b.peerPK &&
        a.funding === b.funding &&
        a.withdrawal === b.withdrawal
    );
}

function sameProfile(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.username === b.username && a.avatar === b.avatar && a.active === b.active && a.bot === b.bot && a.chatPK === b.chatPK;
}

function sameTheme(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.foreground === b.foreground && a.muted === b.muted && a.inflow === b.inflow && a.outflow === b.outflow && a.border === b.border;
}

function TxRowFrame({ children, isLast = false, separatorColor }) {
    return (
        <View style={{ height: TX_ROW_HEIGHT, overflow: 'hidden' }}>
            <View style={{ height: TX_ROW_CONTENT_HEIGHT }}>{children}</View>
            {!isLast ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: TX_ROW_SEPARATOR_HEIGHT, backgroundColor: separatorColor }} /> : null}
        </View>
    );
}

const StableTxAvatar = memo(function StableTxAvatar({ active, bot, uri }) {
    const source = useMemo(() => (uri ? { uri } : null), [uri]);
    return <Avatar pointerEvents="none" source={source} active={active} bot={bot} />;
});

const TxRow = memo(function TxRow({ tx, profile, theme, moneyFormat, btcPrice, isLast, openRoute, rowTimeNow, selectPeerChat, user }) {
    const { chatPK, chatBanned } = user || {};
    const isInflow = (tx?.amount ?? 0) > 0;
    const amountText = renderMoney(tx?.totalValue ?? 0, moneyFormat, btcPrice, isInflow ? '+' : '-');

    const label = tx?.pending ? 'pending' : formatRowDateTime(tx?.createdTime, rowTimeNow);
    const displayName = tx?.funding ? 'Funded' : tx?.withdrawal ? 'Withdrawn' : formatUserDisplay({ username: profile?.username, walletPK: tx?.peerPK });

    const avatarUri = tx?.funding || tx?.withdrawal ? user?.avatar : profile?.avatar;
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

        void selectPeerChat?.(profile.chatPK);
        openRoute({ pathname: '/chat/[peerchatpk]', params: { peerchatpk: profile.chatPK } });
    }, [chatPK, openRoute, profile?.chatPK, selectPeerChat, tx?.funding, tx?.withdrawal]);

    const pressFeedback = useTap({
        disabled: !canOpen,
        onPress: openRow,
        hapticIn: false,
        hapticOut: false,
        hapticPress: 'soft',
        drift: 1,
    });

    const row = (
        <Pressable
            {...pressFeedback.props}
            disabled={!canOpen}
            delayPressIn={80}
            style={{
                height: TX_ROW_CONTENT_HEIGHT,
                paddingVertical: 9,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flex: 1 }}>
                <Animated.View style={{ transform: [{ scale: pressFeedback.scale }] }} pointerEvents="none">
                    <StableTxAvatar uri={avatarUri} active={isActive} bot={!tx?.funding && !tx?.withdrawal && !!profile?.bot} />
                </Animated.View>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: nameWeight, color: nameColor }}>
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
                        marginTop: 7,
                        fontSize: 20,
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

    return <TxRowFrame isLast={isLast} separatorColor={theme.border}>{row}</TxRowFrame>;
}, (prev, next) =>
    prev.moneyFormat === next.moneyFormat &&
    prev.btcPrice === next.btcPrice &&
    prev.isLast === next.isLast &&
    prev.openRoute === next.openRoute &&
    prev.rowTimeNow === next.rowTimeNow &&
    prev.selectPeerChat === next.selectPeerChat &&
    prev.user?.chatPK === next.user?.chatPK &&
    prev.user?.chatBanned === next.user?.chatBanned &&
    prev.user?.avatar === next.user?.avatar &&
    sameTheme(prev.theme, next.theme) &&
    sameTxRow(prev.tx, next.tx) &&
    sameProfile(prev.profile, next.profile)
);

const TxListFooter = memo(function TxListFooter({ bottomPadding, loading, theme }) {
    const loaderHeight = loading ? TX_ROW_HEIGHT : 0;
    if (!loaderHeight && !bottomPadding) return null;

    return (
        <View style={{ height: loaderHeight + bottomPadding }}>
            {loading ? (
                <View style={{ height: TX_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="small" color={theme.foreground} />
                </View>
            ) : null}
        </View>
    );
});

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
    const insets = useSafeAreaInsets();
    const bitcoin = useBitcoin();
    const { balance, hasMoreTxs, isTxLoading, loadMoreTxs, txReady } = useWallet();
    const user = useUser();
    const { settings, chatBanned } = user || {};
    const { peerByWalletPK } = usePeer() || {};
    const { selectPeerChat } = useChat() || {};
    const txData = useTxData();
    const { lockRoute } = useRouteLock();

    const btcPrice = bitcoin?.price ?? BTC_PRICE_FALLBACK;
    const moneyFormat = settings?.moneyFormat ?? 'usd';
    const mainMenuHeight = getMainMenuHeight(insets.bottom);

    const [displayFormat, setDisplayFormat] = useState(null);
    const activeFormat = displayFormat ?? moneyFormat;
    const showBalance = hasAvailableBalance(balance);
    const listBottomPadding = mainMenuHeight + (showBalance ? BALANCE_HEIGHT : 0);
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
    const listEdgeInset = insets.top + ACTIONS_HEIGHT;
    const listTopSpace = listEdgeInset + FLOATING_HEADER_SCROLL_EDGE_PAD + (showBalance ? BALANCE_HEIGHT : 0);
    const listIndicatorInsets = useMemo(() => ({ top: listEdgeInset, bottom: mainMenuHeight }), [listEdgeInset, mainMenuHeight]);
    const cycleFormat = useCallback(() => {
        const abs = Math.abs(Number(balance ?? 0));
        const cycle = abs < 1_000_000 ? ['sats', 'usd'] : ['sats', 'usd', 'btc'];
        const idx = cycle.indexOf(activeFormat);
        setDisplayFormat(cycle[(idx + 1) % cycle.length]);
    }, [activeFormat, balance]);
    const balanceFeedback = useTap({ onPress: cycleFormat, disabled: !showBalance });

    const txListData = txData?.sortedTransactions ?? [];
    const txTimes = useMemo(() => txListData.map((tx) => tx.createdTime), [txListData]);
    const rowTimeNow = useRowDateTimeNow(txTimes);
    const loadingMoreRef = useRef(false);
    const txListShowsLoader = txListData.length > 0 && hasMoreTxs && isTxLoading;
    const txListHasFooter = txListData.length > 0 && (txListShowsLoader || listBottomPadding > 0);

    const balanceText = useMemo(() => {
        if (displayBalance == null) return '';
        return renderBalance(displayBalance, activeFormat, btcPrice);
    }, [displayBalance, activeFormat, btcPrice]);

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

    const handleLoadMoreTxs = useCallback(() => {
        if (!txReady || !hasMoreTxs || isTxLoading || loadingMoreRef.current || typeof loadMoreTxs !== 'function') return;
        loadingMoreRef.current = true;
        Promise.resolve()
            .then(loadMoreTxs)
            .catch(() => {})
            .finally(() => {
                loadingMoreRef.current = false;
            });
    }, [hasMoreTxs, isTxLoading, loadMoreTxs, txReady]);

    const handleTxEndReached = useCallback(() => {
        handleLoadMoreTxs();
    }, [handleLoadMoreTxs]);

    const renderTxItem = useCallback(
        ({ item, index }) => {
            return (
                <TxRow
                    tx={item}
                    profile={item?.peerPK ? peerByWalletPK?.get(item.peerPK) : null}
                    theme={theme}
                    moneyFormat={moneyFormat}
                    btcPrice={btcPrice}
                    isLast={!txListShowsLoader && index === txListData.length - 1}
                    openRoute={openRoute}
                    rowTimeNow={rowTimeNow}
                    selectPeerChat={selectPeerChat}
                    user={user}
                />
            );
        },
        [btcPrice, moneyFormat, openRoute, peerByWalletPK, rowTimeNow, selectPeerChat, theme, txListData.length, txListShowsLoader, user]
    );

    const renderTxEmpty = useCallback(() => <View style={{ flex: 1 }}>{txReady ? <WalletEmpty /> : <WalletLoading />}</View>, [txReady]);

    const getTxItemLayout = useCallback((data, index) => {
        const length = TX_ROW_HEIGHT;
        return { length, offset: listTopSpace + TX_ROW_HEIGHT * index, index };
    }, [listTopSpace]);

    const txListExtraData = useMemo(
        () => ({
            moneyFormat,
            btcPrice,
            chatPK: user?.chatPK || '',
            chatBanned: user?.chatBanned === true,
            avatar: user?.avatar || '',
            foreground: theme.foreground,
            muted: theme.muted,
            inflow: theme.inflow,
            outflow: theme.outflow,
            border: theme.border,
            rowTimeNow,
            txListShowsLoader,
            peerByWalletPK,
        }),
        [
            btcPrice,
            moneyFormat,
            peerByWalletPK,
            theme.border,
            theme.foreground,
            theme.inflow,
            theme.muted,
            theme.outflow,
            rowTimeNow,
            txListShowsLoader,
            user?.avatar,
            user?.chatBanned,
            user?.chatPK,
        ]
    );

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <ScrollEdgeScreen>
                <FlatList
                    data={txListData}
                    keyExtractor={(item) => item.id}
                    renderItem={renderTxItem}
                    extraData={txListExtraData}
                    getItemLayout={getTxItemLayout}
                    onEndReached={handleTxEndReached}
                    onEndReachedThreshold={0.6}
                    ListHeaderComponent={<View style={{ height: listTopSpace }} />}
                    ListFooterComponent={txListHasFooter ? <TxListFooter bottomPadding={listBottomPadding} loading={txListShowsLoader} theme={theme} /> : null}
                    ListEmptyComponent={renderTxEmpty}
                    scrollIndicatorInsets={listIndicatorInsets}
                    contentContainerStyle={{ flexGrow: 1 }}
                    contentInsetAdjustmentBehavior="never"
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                    directionalLockEnabled
                    alwaysBounceHorizontal={false}
                />
            </ScrollEdgeScreen>

            <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + ACTIONS_HEIGHT + BALANCE_HEIGHT, paddingTop: insets.top, paddingBottom: 8, paddingHorizontal: 12, overflow: 'hidden', transform: [{ translateY: headerOffset }] }}>
                <View style={{ height: BALANCE_HEIGHT, overflow: 'hidden', justifyContent: 'center' }}>
                    <Pressable {...balanceFeedback.props} disabled={!showBalance} style={{ alignSelf: 'center', height: BALANCE_HEIGHT, justifyContent: 'center' }}>
                        <Animated.View style={{ transform: [{ scale: balanceScale }] }}>
                            <Animated.View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', transform: [{ scale: balanceFeedback.scale }] }}>
                                <Text style={{ fontSize: 40, fontWeight: '900', color: theme.foreground }}>{balanceText}</Text>
                            </Animated.View>
                        </Animated.View>
                    </Pressable>
                </View>

                <View style={{ width: ACTION_ICON_SIZE * 3 + ACTION_GAP * 2, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: 10, paddingBottom: 14, overflow: 'visible' }}>
                    <Animated.View style={{ transform: [{ translateX: fundOffset }] }}>
                        <GlassIcon glassEffectStyle="clear" rounded={16} icon={BanknoteArrowDown} onPress={() => openRoute('/fundwallet')} />
                    </Animated.View>
                    <View style={{ width: ACTION_GAP }} />
                    <Animated.View pointerEvents={canWithdraw ? 'auto' : 'none'} style={{ transform: [{ scale: balanceScale }] }}>
                        <GlassIcon glassEffectStyle="clear" rounded={16} icon={BanknoteArrowUp} onPress={() => canWithdraw && openRoute('/withdraw')} disabled={!canWithdraw} visible={canWithdraw} />
                    </Animated.View>
                    <View style={{ width: ACTION_GAP }} />
                    <Animated.View style={{ transform: [{ translateX: peerOffset }] }}>
                        <GlassIcon glassEffectStyle="clear" rounded={16} icon={UserRoundPlus} onPress={() => openRoute('/peerselector', 'push', PEER_SELECTOR_LOCK_MS)} disabled={chatBanned} />
                    </Animated.View>
                </View>
            </Animated.View>
        </View>
    );
}
