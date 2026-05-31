import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeviceEventEmitter, FlatList, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle, Search } from 'lucide-react-native';
import { mergeProfiles } from '@veyl/shared/search/merge';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { formatUserDisplay, peerKey } from '@veyl/shared/profile';
import { truncateLabel } from '@veyl/shared/utils/display';
import { getChatId } from '@veyl/shared/crypto/chat';
import { cleanText } from '@veyl/shared/utils/text';
import { waitForIdle } from '@veyl/shared/utils/async';

import { useTheme } from '@/providers/themeprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useChat } from '@/providers/chatprovider';
import { useSearch } from '@/lib/search/usesearch';
import { prepareAssetForChatUpload } from '@/lib/chat/media';
import Avatar from '@/components/avatar';
import EmptyState from '@/components/emptystate';
import GlassButton from '@/components/glass/glassbutton';
import SearchInput from '@/components/search';
import { tap } from '@/lib/tap';

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
    const label = truncateLabel(formatUserDisplay(item), 8, '…');

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

export default function SendPhotoScreen() {
    const { theme } = useTheme();
    const { peers, recentPeers } = usePeer() || {};
    const { uid, chatPK, chatBanned } = useUser();
    const { sendAttachmentMany, sendImageMany, selectChat } = useChat();
    const { searching, results, query, search: runSearch, clearSearch } = useSearch('profiles');
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams();

    const photoUri = textRouteParam(params?.uri);
    const photoWidth = Number(textRouteParam(params?.w)) || 0;
    const photoHeight = Number(textRouteParam(params?.h)) || 0;
    const mediaType = textRouteParam(params?.t) === 'mp4' ? 'video' : 'photo';
    const mediaName = cleanText(textRouteParam(params?.n));

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
        };
    }, [clearSearch]);

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
        const recent = Array.isArray(recentPeers?.chat) ? recentPeers.chat : [];
        const requireChat = (peer) => !!peer?.chatPK;
        if (!search.trim()) return recent.filter((p) => p.uid !== uid && p.chatPK);
        if (!query) return [];
        return mergeProfiles({
            local: list,
            remote: results || [],
            parsed: query,
            excludeUid: uid,
            extraFilter: requireChat,
        });
    }, [peers, query, recentPeers?.chat, results, search, uid]);

    const handleSend = useCallback(async () => {
        if (!photoUri || !selected.length || sending || busyRef.current || chatBanned) return;
        busyRef.current = true;
        setSending(true);

        if (openRef.current) router.dismiss();
        DeviceEventEmitter.emit('photosent');

        waitForIdle({ timeout: 250 })
            .then(() =>
                prepareAssetForChatUpload({
                    uri: photoUri,
                    width: photoWidth,
                    height: photoHeight,
                    mimeType: mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
                    preserveImage: mediaType === 'photo',
                    ...(mediaName ? { fileName: mediaName, name: mediaName } : {}),
                })
            )
            .then(async (prepared) => {
                const targets = selected.map((peer) => peer.chatPK);
                const results = mediaType === 'video' ? await sendAttachmentMany(targets, prepared) : await sendImageMany(targets, prepared);
                const resultByChatPK = new Map(results.map((result) => [result.peerChatPK, result]));

                for (const peer of selected) {
                    const result = resultByChatPK.get(peer.chatPK);
                    if (result?.ok) {
                        if (selected.length === 1) {
                            selectChat(getChatId(chatPK, peer.chatPK));
                        }
                    } else {
                        console.warn(`send ${mediaType} failed:`, result?.error);
                    }
                }
            })
            .catch((error) => {
                console.warn(`prepare ${mediaType} failed:`, error);
            })
            .finally(() => {
                busyRef.current = false;
            });
    }, [chatBanned, chatPK, mediaName, mediaType, photoHeight, photoUri, photoWidth, router, selectChat, selected, sendAttachmentMany, sendImageMany, sending]);

    const selectedUids = useMemo(() => new Set(selected.map((p) => p.uid)), [selected]);

    const renderPeer = useCallback(
        ({ item }) => <PeerCell item={item} onToggle={togglePeer} theme={theme} selected={selectedUids.has(item.uid)} disabled={!item?.chatPK} />,
        [selectedUids, theme, togglePeer]
    );

    const keyExtractor = useCallback((item, index) => peerKey(item, `${index}`), []);
    const hasSelection = selected.length > 0;
    const sendLabel = selected.length > 1 ? `send to ${selected.length} people` : selected.length === 1 ? `send to ${truncateLabel(formatUserDisplay(selected[0]), 12, '…')}` : 'send';

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
                    keyExtractor={keyExtractor}
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
                            <EmptyState icon={MessageCircle} title="no recent friends" />
                        )
                    }
                />
            </View>
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 24, paddingBottom: insets.bottom + 12 }}>
                <GlassButton onPress={handleSend} label={sendLabel} accent disabled={!hasSelection || sending || chatBanned} pressableStyle={{ transform: [{ scale: hasSelection ? 1 : 0.001 }] }} />
            </View>
        </View>
    );
}
