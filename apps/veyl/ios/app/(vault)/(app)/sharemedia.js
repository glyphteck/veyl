import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle, Search } from 'lucide-react-native';
import { mergeProfiles } from '@glyphteck/shared/search/merge';
import { formatUserDisplay } from '@glyphteck/shared/utils';
import { getChatId } from '@glyphteck/shared/crypto/chat';

import { useTheme } from '@/providers/themeprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useChat } from '@/providers/chatprovider';
import { useSearch } from '@/lib/search/usesearch';
import { clearShareMedia, readShareMedia } from '@/lib/sharemedia';
import Avatar from '@/components/avatar';
import EmptyState from '@/components/emptystate';
import GlassButton from '@/components/glass/glassbutton';
import SearchInput from '@/components/search';
import { tap } from '@/lib/tap';

function getPeerLabel(peer) {
    if (!peer) return '';
    return peer?.username || formatUserDisplay({ username: peer?.username, chatPK: peer?.chatPK, walletPK: peer?.walletPK });
}

function truncateLabel(label, max = 8) {
    if (!label || label.length <= max) return label || '';
    return `${label.slice(0, max)}...`;
}

function PeerCell({ item, onToggle, theme, selected, disabled }) {
    const scale = useSharedValue(1);
    const pressFeedback = tap({
        value: scale,
        disabled,
        onPress: () => !disabled && onToggle?.(item),
        hapticIn: 'selection',
    });

    const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
    const avatar = item?.avatar ? { uri: item.avatar } : null;
    const label = truncateLabel(getPeerLabel(item), 8);

    return (
        <Pressable {...pressFeedback} style={{ width: '33.333%', alignItems: 'center', paddingVertical: 10 }}>
            <Animated.View style={[{ alignItems: 'center' }, scaleStyle]}>
                <Avatar pointerEvents="none" source={avatar} size={72} active={!!item?.active} selected={selected} bot={!!item?.bot} />
                <Text numberOfLines={1} style={{ marginTop: 6, fontSize: 12, fontWeight: '700', color: theme.foreground }}>
                    {label}
                </Text>
            </Animated.View>
        </Pressable>
    );
}

export default function ShareMediaScreen() {
    const { theme } = useTheme();
    const { peers } = usePeer() || {};
    const { uid, chatPK, chatBanned } = useUser();
    const { shareAttachment, selectChat } = useChat();
    const { searching, results, query, search: runSearch, clearSearch } = useSearch('profiles');
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams();
    const shareId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
    const msg = useMemo(() => readShareMedia(shareId), [shareId]);

    const searchInputRef = useRef(null);
    const openRef = useRef(true);
    const busyRef = useRef(false);

    const [selected, setSelected] = useState([]);
    const [search, setSearch] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        return () => {
            openRef.current = false;
            clearSearch();
            clearShareMedia(shareId);
        };
    }, [clearSearch, shareId]);

    const togglePeer = useCallback((peer) => {
        setSelected((prev) => {
            const exists = prev.find((p) => p.uid === peer.uid);
            return exists ? prev.filter((p) => p.uid !== peer.uid) : [...prev, peer];
        });
    }, []);

    const handleSearchChange = useCallback(
        (value) => {
            setSearch(value);
            runSearch(value);
        },
        [runSearch]
    );

    const handleClearSearch = useCallback(() => {
        setSearch('');
        clearSearch();
    }, [clearSearch]);

    const filteredPeers = useMemo(() => {
        const list = Array.isArray(peers) ? peers : [];
        const requireChat = (peer) => !!peer?.chatPK;
        if (!search.trim()) return list.filter((p) => p.uid !== uid && p.chatPK);
        if (!query) return [];
        return mergeProfiles({
            local: list,
            remote: results || [],
            parsed: query,
            excludeUid: uid,
            extraFilter: requireChat,
        });
    }, [peers, query, results, search, uid]);

    const handleSend = useCallback(async () => {
        if (!msg || !selected.length || sending || busyRef.current || chatBanned) return;
        busyRef.current = true;
        setSending(true);

        if (openRef.current) router.dismiss();

        try {
            for (const peer of selected) {
                try {
                    await shareAttachment(peer.chatPK, msg);
                    if (selected.length === 1) {
                        selectChat(getChatId(chatPK, peer.chatPK));
                    }
                } catch (error) {
                    console.warn('share media failed:', error);
                }
            }
        } finally {
            busyRef.current = false;
        }
    }, [chatBanned, chatPK, msg, router, selectChat, selected, shareAttachment, sending]);

    const selectedUids = useMemo(() => new Set(selected.map((p) => p.uid)), [selected]);

    const renderPeer = useCallback(
        ({ item }) => <PeerCell item={item} onToggle={togglePeer} theme={theme} selected={selectedUids.has(item.uid)} disabled={!item?.chatPK} />,
        [selectedUids, theme, togglePeer]
    );

    const peerKey = useCallback((item, index) => item?.uid || item?.chatPK || `${index}`, []);
    const sendLabel = selected.length > 1 ? `send to ${selected.length} people` : selected.length === 1 ? `send to ${truncateLabel(getPeerLabel(selected[0]), 12)}` : 'select recipients';

    return (
        <View style={{ flex: 1, paddingHorizontal: 12 }}>
            <View style={{ position: 'absolute', top: 18, left: 0, right: 0, zIndex: 2, paddingHorizontal: 16 }}>
                <SearchInput
                    ref={searchInputRef}
                    value={search}
                    onChangeText={handleSearchChange}
                    onClear={handleClearSearch}
                    searching={searching}
                    glassEffectStyle="clear"
                    tintColor="transparent"
                />
            </View>
            <View style={{ flex: 1, marginTop: 20, overflow: 'hidden' }}>
                <FlatList
                    data={filteredPeers}
                    keyExtractor={peerKey}
                    renderItem={renderPeer}
                    numColumns={3}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ flexGrow: 1, paddingTop: 42, paddingBottom: insets.bottom + 80 }}
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                    automaticallyAdjustContentInsets={false}
                    automaticallyAdjustsScrollIndicatorInsets={false}
                    contentInsetAdjustmentBehavior="never"
                    ListEmptyComponent={
                        searching ? (
                            <EmptyState busy title="searching..." />
                        ) : search && !query ? (
                            <EmptyState icon={Search} title="type a username" />
                        ) : search ? (
                            <EmptyState icon={Search} title="no matches" />
                        ) : (
                            <EmptyState icon={MessageCircle} title={msg ? 'no recent friends' : 'file unavailable'} />
                        )
                    }
                />
            </View>
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 24, paddingBottom: insets.bottom + 12 }}>
                <GlassButton onPress={handleSend} label={sendLabel} accent disabled={!msg || !selected.length || sending || chatBanned} />
            </View>
        </View>
    );
}
