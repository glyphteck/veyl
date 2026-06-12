import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { UserX } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '@/components/avatar';
import EmptyState from '@/components/emptystate';
import FloatingHeader, { FloatingHeaderBackIcon, FLOATING_HEADER_SCROLL_EDGE_PAD, getFloatingHeaderHeight } from '@/components/floatingheader';
import GlassButton from '@/components/glass/glassbutton';
import { ScrollEdgeScreen } from '@/lib/navigation/scrolledge';
import { usePeer } from '@/providers/peerprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { formatUserDisplay } from '@veyl/shared/profile';

function BlockedRow({ item, onUnblock, busyUid }) {
    const { theme } = useTheme();
    const isBusy = busyUid === item?.uid;
    const avatarSource = item?.avatar ? { uri: item.avatar } : null;
    const title = formatUserDisplay({ username: item?.username, walletPK: item?.walletPK, chatPK: item?.chatPK });

    return (
        <View
            style={{
                paddingVertical: 12,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
            }}
        >
            <Avatar pointerEvents="none" source={avatarSource} active={!!item?.active} bot={!!item?.bot} />
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 18, fontWeight: '800', color: theme.foreground }}>
                    {title}
                </Text>
            </View>
            <GlassButton onPress={() => onUnblock(item)} disabled={isBusy} style={{ width: 108 }} height={42}>
                {isBusy ? <ActivityIndicator color={theme.foreground} /> : <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '800' }}>unblock</Text>}
            </GlassButton>
        </View>
    );
}

export default function BlockedRoute() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { blockedPeers, blockedPeersReady, loadBlockedPeers, restorePeer } = usePeer() || {};
    const { unblockPeer } = useUser();
    const [busyUid, setBusyUid] = useState(null);
    const [headerHeight, setHeaderHeight] = useState(() => getFloatingHeaderHeight(insets.top));
    const headerInset = useMemo(() => ({ top: headerHeight }), [headerHeight]);
    const headerOffset = useMemo(() => ({ x: 0, y: -headerHeight }), [headerHeight]);

    useEffect(() => {
        void loadBlockedPeers?.();
    }, [loadBlockedPeers]);

    const blockedItems = useMemo(() => (Array.isArray(blockedPeers) ? blockedPeers : []), [blockedPeers]);

    const handleUnblock = useCallback(
        (peer) => {
            if (!peer?.uid || busyUid) return;

            Alert.alert('Unblock user?', 'They will be able to message you again.', [
                { text: 'cancel', style: 'cancel' },
                {
                    text: 'unblock',
                    style: 'destructive',
                    onPress: () => {
                        void (async () => {
                            setBusyUid(peer.uid);
                            try {
                                await unblockPeer?.(peer);
                                restorePeer?.(peer);
                            } catch (error) {
                                console.warn('unblock peer failed', error);
                                Alert.alert('Unblock failed', error?.message || 'Could not unblock this user.');
                            } finally {
                                setBusyUid(null);
                            }
                        })();
                    },
                },
            ]);
        },
        [busyUid, restorePeer, unblockPeer]
    );

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <ScrollEdgeScreen>
                <FlatList
                    data={blockedItems}
                    keyExtractor={(item) => item.uid}
                    renderItem={({ item }) => <BlockedRow item={item} onUnblock={handleUnblock} busyUid={busyUid} />}
                    ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.border }} />}
                    ListEmptyComponent={() => (blockedPeersReady ? <EmptyState icon={UserX} title="no blocked users" /> : <EmptyState busy title="loading blocked users..." />)}
                    contentInset={headerInset}
                    contentOffset={headerOffset}
                    scrollIndicatorInsets={headerInset}
                    contentContainerStyle={{ flexGrow: 1, paddingTop: FLOATING_HEADER_SCROLL_EDGE_PAD, paddingBottom: insets.bottom + 24 }}
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                    directionalLockEnabled
                    alwaysBounceHorizontal={false}
                />
            </ScrollEdgeScreen>
            <FloatingHeader onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <FloatingHeaderBackIcon onPress={() => router.back()} />
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 24, fontWeight: '900' }}>blocked users</Text>
                </View>
                <View style={{ width: 56 }} />
            </FloatingHeader>
        </View>
    );
}
