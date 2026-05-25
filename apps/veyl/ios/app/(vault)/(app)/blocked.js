import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, UserX } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '@/components/avatar';
import EmptyState from '@/components/emptystate';
import GlassButton from '@/components/glass/glassbutton';
import GlassHeader from '@/components/glass/glassheader';
import Icon from '@/components/icon';
import { useTap } from '@/lib/tap';
import { usePeer } from '@/providers/peerprovider';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';
import { formatUserDisplay } from '@glyphteck/shared/utils';

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
    const backTap = useTap({ onPress: router.back });

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
            <FlatList
                data={blockedItems}
                keyExtractor={(item) => item.uid}
                renderItem={({ item }) => <BlockedRow item={item} onUnblock={handleUnblock} busyUid={busyUid} />}
                ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.border }} />}
                ListEmptyComponent={() => (blockedPeersReady ? <EmptyState icon={UserX} title="no blocked users" /> : <EmptyState busy title="loading blocked users..." />)}
                contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 38, paddingBottom: insets.bottom + 24 }}
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                bounces
                alwaysBounceVertical
                directionalLockEnabled
                alwaysBounceHorizontal={false}
            />
            <GlassHeader contentStyle={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <Pressable {...backTap.props} hitSlop={10} style={{ justifyContent: 'center' }}>
                        <Animated.View style={{ transform: [{ scale: backTap.scale }] }}>
                            <Icon icon={ChevronLeft} size={32} color={theme.foreground} />
                        </Animated.View>
                    </Pressable>
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 24, fontWeight: '900' }}>blocked users</Text>
                </View>
                <View style={{ width: 56 }} />
            </GlassHeader>
        </View>
    );
}
