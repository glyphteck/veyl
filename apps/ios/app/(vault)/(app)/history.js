import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, FlatList, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { History } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '@/components/avatar';
import EmptyState from '@/components/emptystate';
import FloatingHeader, { FloatingHeaderBackIcon, FLOATING_HEADER_SCROLL_EDGE_PAD, getFloatingHeaderHeight } from '@/components/floatingheader';
import GlassFooter from '@/components/glass/glassfooter';
import { ScrollEdgeScreen } from '@/lib/navigation/scrolledge';
import { useTap } from '@/lib/tap';
import { useBitcoin } from '@/providers/bitcoinprovider';
import { usePeer } from '@/providers/peerprovider';
import { useTheme } from '@/providers/themeprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { BTC_PRICE_FALLBACK } from '@veyl/shared/config';
import { renderMoney, renderNet } from '@veyl/shared/money';
import { formatUserDisplay } from '@veyl/shared/profile';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { formatRowDateTime } from '@veyl/shared/utils/time';
import { useRowDateTimeNow } from '@veyl/shared/utils/userowdatetime';

function TxRow({ tx, theme, moneyFormat, btcPrice, peerAvatarSource, userAvatarSource, isPeerActive, isPeerBot, isLast, rowTimeNow }) {
    const isInflow = (tx?.amount ?? 0) > 0;
    const amountText = renderMoney(tx?.totalValue ?? 0, moneyFormat, btcPrice, isInflow ? '+' : '-');
    const label = tx?.pending ? 'pending' : formatRowDateTime(tx?.createdTime, rowTimeNow);
    const title = isInflow ? 'received' : 'sent';
    const avatarSource = isInflow ? peerAvatarSource : userAvatarSource;
    const isActive = isInflow ? isPeerActive : false;

    return (
        <View
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
                <Avatar pointerEvents="none" source={avatarSource} active={isActive} bot={isInflow ? isPeerBot : false} />
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '700', color: theme.foreground }}>
                    {title}
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
        </View>
    );
}

export default function HistoryRoute() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const params = useLocalSearchParams();
    const { peerByWalletPK, peerByChatPK } = usePeer() || {};
    const { settings, avatar } = useUser();
    const bitcoin = useBitcoin();
    const { hasMoreTxs, isTxLoading, loadMoreTxs } = useWallet();
    const { getPeerStats, getPeerTxs } = useTxData();
    const [displayFormat, setDisplayFormat] = useState(null);
    const [headerHeight, setHeaderHeight] = useState(() => getFloatingHeaderHeight(insets.top));
    const [footerHeight, setFooterHeight] = useState(0);
    const headerInset = useMemo(() => ({ top: headerHeight }), [headerHeight]);
    const headerOffset = useMemo(() => ({ x: 0, y: -headerHeight }), [headerHeight]);
    const handleLoadMoreTxs = useCallback(() => {
        if (!hasMoreTxs || isTxLoading) return;
        void loadMoreTxs?.();
    }, [hasMoreTxs, isTxLoading, loadMoreTxs]);

    const peerWalletPK = textRouteParam(params?.walletPK);
    const peerChatPK = textRouteParam(params?.chatPK);
    const moneyFormat = settings?.moneyFormat ?? 'usd';
    const btcPrice = bitcoin?.price ?? BTC_PRICE_FALLBACK;

    const peerProfile = useMemo(() => {
        return (peerWalletPK ? peerByWalletPK?.get(peerWalletPK) : null) ?? (peerChatPK ? peerByChatPK?.get(peerChatPK) : null) ?? null;
    }, [peerByChatPK, peerByWalletPK, peerChatPK, peerWalletPK]);

    const txs = useMemo(() => {
        return getPeerTxs?.(peerWalletPK) ?? [];
    }, [getPeerTxs, peerWalletPK]);
    const txTimes = useMemo(() => txs.map((tx) => tx.createdTime), [txs]);
    const rowTimeNow = useRowDateTimeNow(txTimes);

    const stats = useMemo(() => {
        const sharedStats = getPeerStats?.(peerWalletPK);
        if (sharedStats) return sharedStats;
        return {
            cnt: txs.length,
            vol: txs.reduce((sum, tx) => sum + (tx?.totalValue ?? 0), 0),
            net: txs.reduce((sum, tx) => sum + (tx?.amount ?? 0), 0),
        };
    }, [getPeerStats, peerWalletPK, txs]);

    const activeFormat = displayFormat ?? moneyFormat;
    const title = useMemo(
        () =>
            formatUserDisplay({
                username: peerProfile?.username,
                walletPK: peerWalletPK || peerProfile?.walletPK,
                chatPK: peerChatPK || peerProfile?.chatPK,
            }),
        [peerChatPK, peerProfile?.chatPK, peerProfile?.username, peerProfile?.walletPK, peerWalletPK]
    );
    const peerAvatarSource = peerProfile?.avatar ? { uri: peerProfile.avatar } : null;
    const userAvatarSource = avatar ? { uri: avatar } : null;
    const isPeerActive = !!peerProfile?.active;
    const volume = stats?.vol ?? 0;
    const txCount = stats?.cnt ?? txs.length;
    const net = stats?.net ?? txs.reduce((sum, tx) => sum + (tx?.amount ?? 0), 0);
    const netText = renderNet(net, activeFormat, btcPrice);
    const volumeText = peerWalletPK ? renderMoney(volume, activeFormat, btcPrice) : '—';
    const volumeTap = useTap({
        onPress: () => {
            const abs = Math.abs(Number(volume ?? 0));
            const cycle = abs < 1_000_000 ? ['sats', 'usd'] : ['sats', 'usd', 'btc'];
            const idx = cycle.indexOf(activeFormat);
            setDisplayFormat(cycle[(idx + 1) % cycle.length]);
        },
    });
    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <ScrollEdgeScreen>
                <FlatList
                    data={txs}
                    keyExtractor={(item) => item.id}
                    extraData={rowTimeNow}
                    renderItem={({ item, index }) => (
                        <TxRow
                            tx={item}
                            theme={theme}
                            moneyFormat={activeFormat}
                            btcPrice={btcPrice}
                            peerAvatarSource={peerAvatarSource}
                            userAvatarSource={userAvatarSource}
                            isPeerActive={isPeerActive}
                            isPeerBot={!!peerProfile?.bot}
                            isLast={index === txs.length - 1}
                            rowTimeNow={rowTimeNow}
                        />
                    )}
                    onEndReached={handleLoadMoreTxs}
                    onEndReachedThreshold={0.6}
                    ListEmptyComponent={() => <EmptyState icon={History} title="no transactions with this user yet" />}
                    contentInset={headerInset}
                    contentOffset={headerOffset}
                    scrollIndicatorInsets={headerInset}
                    contentContainerStyle={{ flexGrow: 1, paddingTop: FLOATING_HEADER_SCROLL_EDGE_PAD, paddingBottom: footerHeight }}
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                    directionalLockEnabled
                    alwaysBounceHorizontal={false}
                />
            </ScrollEdgeScreen>
            <GlassFooter onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}>
                <Pressable {...volumeTap.props} style={{ alignSelf: 'center' }}>
                    <Animated.View style={{ alignItems: 'center', justifyContent: 'center', transform: [{ scale: volumeTap.scale }] }}>
                        <Text style={{ fontSize: 40, fontWeight: '900', color: theme.foreground }}>{volumeText}</Text>
                    </Animated.View>
                </Pressable>

                <Text style={{ marginTop: 4, textAlign: 'center', fontSize: 13, fontWeight: '700', color: theme.muted }}>
                    {txCount > 0 ? `${txCount} tx${txCount === 1 ? '' : 's'} • ` : 'no activity • '}
                    <Text style={{ color: net > 0 ? theme.inflow : net < 0 ? theme.outflow : theme.foreground }}>{`net ${netText}`}</Text>
                </Text>
            </GlassFooter>
            <FloatingHeader onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <FloatingHeaderBackIcon onPress={() => router.back()} />
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' }}>
                        <Avatar size={42} source={peerAvatarSource} pointerEvents="none" bot={!!peerProfile?.bot} />
                        <Text numberOfLines={1} style={{ flexShrink: 1, textAlign: 'center', color: theme.foreground, fontSize: 24, fontWeight: '800' }}>
                            {title}
                        </Text>
                    </View>
                </View>
                <View style={{ width: 56 }} />
            </FloatingHeader>
        </View>
    );
}
