import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import { BanknoteArrowDown, BanknoteArrowUp, UserRoundPlus } from 'lucide-react-native';
import ReAnimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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
import { useRouteLock } from '@/lib/navigation/routelock';
import { useTap } from '@/lib/tap';
import { BTC_PRICE_FALLBACK } from '@veyl/shared/config';
import { getChatId } from '@veyl/shared/crypto/chat';
import { renderBalance, renderMoney } from '@veyl/shared/money';
import { formatUserDisplay } from '@veyl/shared/profile';
import { formatFullDateTime } from '@veyl/shared/utils/time';
import { getInsertedRowBatch, sameListIds } from '@veyl/shared/chat/listanimation';
import { hasAvailableBalance } from '@veyl/shared/wallet/balance';

const BALANCE_HEIGHT = 42;
const LIST_BOTTOM_GAP = 44;
const ACTIONS_HEIGHT = 72;
const ACTION_ICON_SIZE = 56;
const ACTION_GAP = 24;
const ACTION_COLLAPSE_OFFSET = (ACTION_ICON_SIZE + ACTION_GAP) / 2;
const PEER_SELECTOR_LOCK_MS = 520;
const TX_ROW_HEIGHT = 71;
const TX_LOADER_HEIGHT = 84;
const TX_ROW_APPEAR_MS = 320;
const TX_ROW_APPEAR_FROM = 0.98;
const MAX_TX_ANIMATED_INSERTS = 8;
const TX_INITIAL_RENDER_COUNT = 64;
const TX_RENDER_BATCH_SIZE = 64;
const TX_LOADER_ITEM = Object.freeze({ id: '__tx_loader__', kind: 'loader' });

function clamp(value, min, max) {
    'worklet';
    return Math.min(Math.max(value, min), max);
}

function easeOutCubic(value) {
    'worklet';
    const t = clamp(value, 0, 1);
    return 1 - Math.pow(1 - t, 3);
}

function getTxIds(txs) {
    return (txs || []).map((tx) => tx?.id).filter(Boolean);
}

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

function useTxInsertStyles(animationKey) {
    const progress = useSharedValue(0);

    useEffect(() => {
        progress.value = 0;
        progress.value = withTiming(1, { duration: TX_ROW_APPEAR_MS, easing: Easing.linear });
    }, [animationKey, progress]);

    const slotStyle = useAnimatedStyle(() => {
        const grow = easeOutCubic(progress.value * 2);
        return { height: TX_ROW_HEIGHT * grow };
    });

    const contentStyle = useAnimatedStyle(() => {
        const fade = easeOutCubic((progress.value - 0.5) * 2);
        return {
            opacity: fade,
            transform: [{ scale: TX_ROW_APPEAR_FROM + (1 - TX_ROW_APPEAR_FROM) * fade }],
        };
    });

    return { contentStyle, slotStyle };
}

function TxInsertSlot({ animationKey, children }) {
    const { contentStyle, slotStyle } = useTxInsertStyles(animationKey);

    return (
        <ReAnimated.View style={[{ overflow: 'hidden' }, slotStyle]}>
            <ReAnimated.View style={contentStyle}>{children}</ReAnimated.View>
        </ReAnimated.View>
    );
}

function useAnimatedRecentTxs(recentTxs) {
    const [displayTxs, setDisplayTxs] = useState(recentTxs);
    const [insertState, setInsertState] = useState(() => ({ ids: new Set(), key: 0 }));
    const displayRef = useRef(recentTxs);
    const pendingRef = useRef(null);
    const animatingRef = useRef(false);
    const timerRef = useRef(null);
    const applyRef = useRef(null);
    const keyRef = useRef(0);

    const clearTimer = useCallback(() => {
        if (!timerRef.current) return;
        clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const startInsert = useCallback(
        (nextTxs, batch) => {
            clearTimer();
            animatingRef.current = true;
            displayRef.current = nextTxs;
            keyRef.current += 1;
            setDisplayTxs(nextTxs);
            setInsertState({ ids: new Set(batch.ids), key: keyRef.current });
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                animatingRef.current = false;
                setInsertState({ ids: new Set(), key: keyRef.current });

                const pending = pendingRef.current;
                pendingRef.current = null;
                if (pending) {
                    applyRef.current?.(pending);
                }
            }, TX_ROW_APPEAR_MS);
        },
        [clearTimer]
    );

    const applyTxs = useCallback(
        (nextTxs) => {
            const previousIds = getTxIds(displayRef.current);
            const nextIds = getTxIds(nextTxs);
            if (sameListIds(previousIds, nextIds)) {
                if (displayRef.current !== nextTxs) {
                    displayRef.current = nextTxs;
                    setDisplayTxs(nextTxs);
                }
                return;
            }

            const insertBatch = getInsertedRowBatch(previousIds, nextIds);
            if (insertBatch && insertBatch.ids.length <= MAX_TX_ANIMATED_INSERTS) {
                startInsert(nextTxs, insertBatch);
                return;
            }

            displayRef.current = nextTxs;
            setDisplayTxs(nextTxs);
            setInsertState({ ids: new Set(), key: keyRef.current });
        },
        [startInsert]
    );

    useEffect(() => {
        applyRef.current = applyTxs;
    }, [applyTxs]);

    useEffect(() => {
        if (animatingRef.current) {
            pendingRef.current = recentTxs;
            return;
        }
        applyTxs(recentTxs);
    }, [applyTxs, recentTxs]);

    useEffect(
        () => () => {
            clearTimer();
        },
        [clearTimer]
    );

    return { animationKey: insertState.key, displayTxs, insertingIds: insertState.ids };
}

const StableTxAvatar = memo(function StableTxAvatar({ active, bot, uri }) {
    const source = useMemo(() => (uri ? { uri } : null), [uri]);
    return <Avatar pointerEvents="none" source={source} active={active} bot={bot} />;
});

const TxRow = memo(function TxRow({ animationKey, inserting = false, tx, profile, theme, moneyFormat, btcPrice, isLast, openRoute, selectChat, user }) {
    const { chatPK, chatBanned } = user || {};
    const isInflow = (tx?.amount ?? 0) > 0;
    const amountText = renderMoney(tx?.totalValue ?? 0, moneyFormat, btcPrice, isInflow ? '+' : '-');

    const label = tx?.pending ? 'pending' : formatFullDateTime(tx?.createdTime);
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

    const row = (
        <Pressable
            {...pressFeedback.props}
            disabled={!canOpen}
            delayPressIn={80}
            style={{
                paddingVertical: 9,
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

    if (!inserting) {
        return <View style={{ height: TX_ROW_HEIGHT, overflow: 'hidden' }}>{row}</View>;
    }

    return <TxInsertSlot animationKey={animationKey}>{row}</TxInsertSlot>;
}, (prev, next) =>
    prev.animationKey === next.animationKey &&
    prev.inserting === next.inserting &&
    prev.moneyFormat === next.moneyFormat &&
    prev.btcPrice === next.btcPrice &&
    prev.isLast === next.isLast &&
    prev.openRoute === next.openRoute &&
    prev.selectChat === next.selectChat &&
    prev.user?.chatPK === next.user?.chatPK &&
    prev.user?.chatBanned === next.user?.chatBanned &&
    prev.user?.avatar === next.user?.avatar &&
    sameTheme(prev.theme, next.theme) &&
    sameTxRow(prev.tx, next.tx) &&
    sameProfile(prev.profile, next.profile)
);

const TxLoaderRow = memo(function TxLoaderRow({ theme }) {
    return (
        <View style={{ height: TX_LOADER_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={theme.muted} />
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
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    const bitcoin = useBitcoin();
    const { balance, hasMoreTxs, isTxLoading, loadMoreTxs, txReady } = useWallet();
    const user = useUser();
    const { settings, chatBanned } = user || {};
    const { peerByWalletPK } = usePeer() || {};
    const { selectChat } = useChat() || {};
    const txData = useTxData();
    const { lockRoute } = useRouteLock();

    const btcPrice = bitcoin?.price ?? BTC_PRICE_FALLBACK;
    const moneyFormat = settings?.moneyFormat ?? 'usd';

    const [displayFormat, setDisplayFormat] = useState(null);
    const activeFormat = displayFormat ?? moneyFormat;
    const showBalance = hasAvailableBalance(balance);
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

    const txs = txData?.sortedTransactions ?? [];
    const { animationKey: txAnimationKey, displayTxs, insertingIds } = useAnimatedRecentTxs(txs);
    const loadingMoreRef = useRef(false);
    const txLoadArmedRef = useRef(false);

    const balanceText = useMemo(() => {
        if (displayBalance == null) return '';
        return renderBalance(displayBalance, activeFormat, btcPrice);
    }, [displayBalance, activeFormat, btcPrice]);

    useEffect(() => {
        if (!isFocused || chatBanned) return;

        let frame = null;
        const timer = setTimeout(() => {
            frame = requestAnimationFrame(() => {
                router.prefetch('/peerselector');
            });
        }, 700);

        return () => {
            clearTimeout(timer);
            if (frame != null) {
                cancelAnimationFrame(frame);
            }
        };
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

    useEffect(() => {
        if (!isTxLoading) {
            loadingMoreRef.current = false;
        }
    }, [isTxLoading]);

    const handleLoadMoreTxs = useCallback(() => {
        if (!txLoadArmedRef.current || !hasMoreTxs || isTxLoading || loadingMoreRef.current) return;
        txLoadArmedRef.current = false;
        loadingMoreRef.current = true;
        const request = loadMoreTxs?.();
        Promise.resolve(request).finally(() => {
            loadingMoreRef.current = false;
        });
    }, [hasMoreTxs, isTxLoading, loadMoreTxs]);

    const handleTxEndReached = useCallback(() => {
        handleLoadMoreTxs();
    }, [handleLoadMoreTxs]);

    const armTxLoadMore = useCallback(() => {
        if (txReady) {
            txLoadArmedRef.current = true;
        }
    }, [txReady]);

    const txListHasLoader = displayTxs.length > 0 && (hasMoreTxs || isTxLoading);
    const txListData = useMemo(() => (txListHasLoader ? [...displayTxs, TX_LOADER_ITEM] : displayTxs), [displayTxs, txListHasLoader]);

    const renderTxItem = useCallback(
        ({ item, index }) => {
            if (item?.kind === 'loader') {
                return <TxLoaderRow theme={theme} />;
            }
            return (
                <TxRow
                    animationKey={insertingIds.has(item.id) ? txAnimationKey : 0}
                    inserting={insertingIds.has(item.id)}
                    tx={item}
                    profile={item?.peerPK ? peerByWalletPK?.get(item.peerPK) : null}
                    theme={theme}
                    moneyFormat={moneyFormat}
                    btcPrice={btcPrice}
                    isLast={!txListHasLoader && index === txListData.length - 1}
                    openRoute={openRoute}
                    selectChat={selectChat}
                    user={user}
                />
            );
        },
        [btcPrice, insertingIds, moneyFormat, openRoute, peerByWalletPK, selectChat, theme, txAnimationKey, txListData.length, txListHasLoader, user]
    );

    const getTxItemLayout = useCallback((data, index) => {
        const length = data?.[index]?.kind === 'loader' ? TX_LOADER_HEIGHT : TX_ROW_HEIGHT;
        return { length, offset: listTopSpace + TX_ROW_HEIGHT * index, index };
    }, [listTopSpace]);

    const txListExtraData = useMemo(
        () => [
            txAnimationKey,
            moneyFormat,
            btcPrice,
            user?.chatPK || '',
            user?.chatBanned ? '1' : '0',
            user?.avatar || '',
            theme.foreground,
            theme.muted,
            theme.inflow,
            theme.outflow,
            theme.border,
            txListHasLoader ? '1' : '0',
        ].join('|'),
        [btcPrice, moneyFormat, theme.border, theme.foreground, theme.inflow, theme.muted, theme.outflow, txAnimationKey, txListHasLoader, user?.avatar, user?.chatBanned, user?.chatPK]
    );

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <Animated.View style={{ flex: 1, transform: [{ translateY: listOffset }] }}>
                <FlatList
                    data={txListData}
                    keyExtractor={(item) => item.id}
                    renderItem={renderTxItem}
                    extraData={txListExtraData}
                    getItemLayout={getTxItemLayout}
                    initialNumToRender={TX_INITIAL_RENDER_COUNT}
                    maxToRenderPerBatch={TX_RENDER_BATCH_SIZE}
                    removeClippedSubviews={false}
                    updateCellsBatchingPeriod={0}
                    windowSize={25}
                    onEndReached={handleTxEndReached}
                    onEndReachedThreshold={0.6}
                    onScrollBeginDrag={armTxLoadMore}
                    ListHeaderComponent={<View style={{ height: listTopSpace }} />}
                    ListEmptyComponent={() => (txReady ? <WalletEmpty /> : <WalletLoading />)}
                    contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + LIST_BOTTOM_GAP + BALANCE_HEIGHT }}
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
