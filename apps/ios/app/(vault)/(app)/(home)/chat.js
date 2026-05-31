import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Search, Trash2 } from 'lucide-react-native';
import ReAnimated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { mergeProfiles } from '@veyl/shared/search/merge';
import { useTheme } from '@/providers/themeprovider';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { usePeer } from '@/providers/peerprovider';
import { useSearch } from '@/lib/search/usesearch';
import Avatar from '@/components/avatar';
import EmptyState from '@/components/emptystate';
import GlassHeader from '@/components/glass/glassheader';
import Icon from '@/components/icon';
import { getMainMenuHeight } from '@/components/mainmenu';
import SearchInput from '@/components/search';
import { useRouteLock } from '@/lib/navigation/routelock';
import { useTap } from '@/lib/tap';
import { formatUserDisplay } from '@veyl/shared/profile';
import { formatFullDateTime } from '@veyl/shared/utils/time';
import { getChatId } from '@veyl/shared/crypto/chat';
import { getChatPeerPK } from '@veyl/shared/chat/ids';
import { getMsgPreview } from '@veyl/shared/chat/messages';
import { lowerText } from '@veyl/shared/utils/text';

const SEARCH_BAR_HEIGHT = 42;
const HEADER_BOTTOM_PADDING = 8;
const DELETE_DRAG = 24;
const DELETE_HINT_W = 60;
const DELETE_TRIGGER = 80;
const DELETE_ICON_DELAY = 20;
const DELETE_SPRING = {
    mass: 0.16,
    stiffness: 200,
    damping: 4.5,
};

function clamp(value, min, max) {
    'worklet';
    return Math.min(Math.max(value, min), max);
}

function rubberBand(value, dimension) {
    'worklet';
    if (value <= 0 || dimension <= 0) return 0;
    return (1 - 1 / (value / dimension + 1)) * dimension;
}

function revealDelete(value) {
    'worklet';
    if (value <= 0) return 0;
    if (value <= DELETE_DRAG) return value;
    return DELETE_DRAG + rubberBand(value - DELETE_DRAG, DELETE_HINT_W);
}

function ChatRow({ onPress, onDelete, title, subtitle, rightLabel, isUnseen, avatarSource, isActive, isBot, isLast = false }) {
    const { theme } = useTheme();
    const swipe = useSharedValue(0);
    const deleteFired = useSharedValue(false);
    const hasSubtitle = !!String(subtitle ?? '').trim();

    const fireHaptic = useCallback(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }, []);

    const handleDelete = useCallback(() => {
        onDelete?.();
    }, [onDelete]);

    const deleteGesture = useMemo(
        () =>
            Gesture.Pan()
                .enabled(typeof onDelete === 'function')
                .activeOffsetX(4)
                .failOffsetX(-4)
                .failOffsetY([-10, 10])
                .onUpdate((event) => {
                    'worklet';
                    const drag = Math.max(event.translationX, 0);
                    swipe.value = revealDelete(drag);
                    if (drag >= DELETE_TRIGGER && !deleteFired.value) {
                        deleteFired.value = true;
                        scheduleOnRN(fireHaptic);
                    } else if (drag < DELETE_TRIGGER) {
                        deleteFired.value = false;
                    }
                })
                .onEnd((event) => {
                    'worklet';
                    const drag = Math.max(event.translationX, 0);
                    if (drag >= DELETE_TRIGGER) {
                        scheduleOnRN(handleDelete);
                    }
                })
                .onFinalize(() => {
                    'worklet';
                    swipe.value = withSpring(0, DELETE_SPRING);
                    deleteFired.value = false;
                }),
        [onDelete, swipe, deleteFired, fireHaptic, handleDelete]
    );

    const swipeMoveStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: swipe.value }],
    }));

    const trashStyle = useAnimatedStyle(() => {
        const drag = swipe.value;
        const reveal = clamp((drag - DELETE_ICON_DELAY) / 40, 0, 1);
        return {
            opacity: reveal,
            transform: [{ scale: 0.84 + reveal * 0.24 }],
        };
    });

    const pressFeedback = useTap({
        onPress,
        hapticIn: false,
        hapticOut: false,
        hapticPress: 'soft',
        drift: 1,
    });

    const rowContent = (
        <Pressable
            {...pressFeedback.props}
            delayPressIn={80}
            style={{
                paddingVertical: 9,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
            }}
        >
            <Animated.View style={{ transform: [{ scale: pressFeedback.scale }] }}>
                <Avatar source={avatarSource} active={isActive} bot={isBot} />
            </Animated.View>
            <View style={{ flex: 1, justifyContent: hasSubtitle ? 'flex-start' : 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: hasSubtitle ? 'baseline' : 'center', justifyContent: 'space-between', gap: 12 }}>
                    <Text style={{ flex: 1, fontSize: 17, fontWeight: isUnseen ? '900' : '700', color: theme.foreground }} numberOfLines={1}>
                        {title}
                    </Text>
                    {!!rightLabel && (
                        <Text style={{ fontSize: 12, fontWeight: '700', color: theme.muted }} numberOfLines={1}>
                            {rightLabel}
                        </Text>
                    )}
                </View>
                {hasSubtitle ? (
                    <Text style={{ marginTop: 7, fontSize: 14, color: isUnseen ? theme.foreground : theme.muted }} numberOfLines={1}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );

    if (typeof onDelete !== 'function') {
        return (
            <View style={{ overflow: 'hidden' }}>
                {rowContent}
                {!isLast ? <View pointerEvents="none" style={{ height: 1, backgroundColor: theme.border }} /> : null}
            </View>
        );
    }

    return (
        <View style={{ overflow: 'hidden' }}>
            <ReAnimated.View
                pointerEvents="none"
                style={[
                    {
                        position: 'absolute',
                        left: 16,
                        top: 0,
                        bottom: 0,
                        width: DELETE_HINT_W,
                        justifyContent: 'center',
                        alignItems: 'center',
                    },
                    trashStyle,
                ]}
            >
                <Icon icon={Trash2} color={theme.destructive} />
            </ReAnimated.View>
            <GestureDetector gesture={deleteGesture}>
                <ReAnimated.View collapsable={false} style={swipeMoveStyle}>
                    {rowContent}
                </ReAnimated.View>
            </GestureDetector>
            {!isLast ? <View pointerEvents="none" style={{ height: 1, backgroundColor: theme.border }} /> : null}
        </View>
    );
}

export default function ChatList() {
    const { theme } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { chats, isChatDataReady, hasMoreChats, loadingMoreChats, loadMoreChats, deleteChat, restoreDeletedChat } = useChat();
    const { chatPK, blockedSet, chatBanned } = useUser();
    const { peers, peerByChatPK, isBlockedChatPK, isPeerDataReady } = usePeer() || {};
    const { searching, results, query, search: runSearch, clearSearch } = useSearch('profiles');
    const { lockRoute } = useRouteLock();
    const searchInputRef = useRef(null);
    const [search, setSearch] = useState('');
    const headerHeight = insets.top + SEARCH_BAR_HEIGHT + HEADER_BOTTOM_PADDING;
    const mainMenuHeight = getMainMenuHeight(insets.bottom);

    const chatQuery = useMemo(() => lowerText(search), [search]);

    const hasBlockedUsers = !!blockedSet?.size;
    const showLoadingChats = !chatQuery && (!isChatDataReady || (hasBlockedUsers && !isPeerDataReady && Array.isArray(chats) && chats.length > 0));

    const filteredChats = useMemo(() => {
        if (hasBlockedUsers && !isPeerDataReady) {
            return [];
        }

        const baseItems = Array.isArray(chats) ? chats.filter((chat) => !isBlockedChatPK?.(getChatPeerPK(chat, chatPK))) : [];

        if (!chatQuery) return baseItems;

        return baseItems.filter((chat) => {
            const peerChatPK = getChatPeerPK(chat, chatPK);
            const profile = peerChatPK ? peerByChatPK?.get(peerChatPK) : null;
            const title = lowerText(formatUserDisplay({ username: profile?.username, chatPK: peerChatPK }));
            const username = lowerText(profile?.username);
            const atUsername = username ? `@${username}` : '';
            const preview = lowerText(getMsgPreview(chat?.lastMsg, chatPK, null, null));
            const peerKey = lowerText(peerChatPK);

            return title.includes(chatQuery) || username.includes(chatQuery) || atUsername.includes(chatQuery) || preview.includes(chatQuery) || peerKey.includes(chatQuery);
        });
    }, [chatPK, chatQuery, chats, hasBlockedUsers, isBlockedChatPK, isPeerDataReady, peerByChatPK]);

    const chatIds = useMemo(() => new Set((Array.isArray(chats) ? chats : []).map((chat) => chat?.id).filter(Boolean)), [chats]);

    const searchPeers = useMemo(() => {
        if (!query || !chatPK) return [];
        const merged = mergeProfiles({
            local: peers || [],
            remote: results || [],
            parsed: query,
            extraFilter: (peer) => {
                if (!peer?.chatPK || peer.chatPK === chatPK) return false;
                return !chatIds.has(getChatId(chatPK, peer.chatPK));
            },
        });
        return merged.map((peer) => {
            const key = peer.uid || peer.chatPK || peer.walletPK;
            return { id: `peer:${key}`, peer, chatId: getChatId(chatPK, peer.chatPK), peerChatPK: peer.chatPK, type: 'peer' };
        });
    }, [chatIds, chatPK, peers, query, results]);

    const items = useMemo(() => [...filteredChats.map((chat) => ({ id: chat.id, chat, type: 'chat' })), ...searchPeers], [filteredChats, searchPeers]);

    const handleLoadMoreChats = useCallback(() => {
        if (chatQuery || !hasMoreChats || loadingMoreChats) {
            return;
        }
        void loadMoreChats?.();
    }, [chatQuery, hasMoreChats, loadingMoreChats, loadMoreChats]);

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

    const handleDeleteChat = useCallback(
        (chatId) => {
            if (!chatId) return;
            Alert.alert('delete chat?', 'This removes the chat from your list.', [
                { text: 'cancel', style: 'cancel' },
                {
                    text: 'delete',
                    style: 'destructive',
                    onPress: () => {
                        Promise.resolve(deleteChat?.(chatId)).catch((err) => {
                            restoreDeletedChat?.(chatId);
                            console.warn('deleteChat failed', err);
                        });
                    },
                },
            ]);
        },
        [deleteChat, restoreDeletedChat]
    );

    useEffect(() => {
        return () => {
            clearSearch();
        };
    }, [clearSearch]);

    const openChat = useCallback(
        (peerChatPK) => {
            if (!peerChatPK) return;
            if (!lockRoute()) return;
            router.push({ pathname: '/chat/[peerchatpk]', params: { peerchatpk: peerChatPK } });
        },
        [lockRoute, router]
    );

    const renderItem = useCallback(
        ({ item, index }) => {
            const isLast = index === items.length - 1;
            if (item.type === 'peer') {
                const profile = item.peer;
                const title = formatUserDisplay({ username: profile?.username, chatPK: profile?.chatPK, walletPK: profile?.walletPK });
                const avatarSource = profile?.avatar ? { uri: profile.avatar } : null;

                return (
                    <ChatRow
                        title={title}
                        subtitle="start chat"
                        rightLabel="new"
                        isUnseen={false}
                        avatarSource={avatarSource}
                        isActive={!!profile?.active}
                        isBot={!!profile?.bot}
                        isLast={isLast}
                        onPress={() => openChat(item.peerChatPK)}
                    />
                );
            }

            const chat = item.chat;
            const peerChatPK = getChatPeerPK(chat, chatPK);
            const profile = peerChatPK ? peerByChatPK?.get(peerChatPK) : null;
            const title = formatUserDisplay({ username: profile?.username, chatPK: peerChatPK });
            const avatarSource = profile?.avatar ? { uri: profile.avatar } : null;
            const subtitle = getMsgPreview(chat?.lastMsg, chatPK, null, null);
            const lastMs = chat?.ts || null;
            const rightLabel = lastMs ? formatFullDateTime(lastMs) : '';
            const isActive = !!profile?.active;

            return (
                <ChatRow
                    title={title}
                    subtitle={subtitle}
                    rightLabel={rightLabel}
                    isUnseen={!!chat?.unseen}
                    avatarSource={avatarSource}
                    isActive={isActive}
                    isBot={!!profile?.bot}
                    isLast={isLast}
                    onPress={() => openChat(peerChatPK)}
                    onDelete={() => handleDeleteChat(chat.id)}
                />
            );
        },
        [chatPK, handleDeleteChat, items.length, openChat, peerByChatPK]
    );

    if (chatBanned) {
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
                <Text style={{ textAlign: 'center', fontSize: 24, fontWeight: '900', color: theme.foreground }}>chat unavailable</Text>
                <Text style={{ marginTop: 10, textAlign: 'center', fontSize: 16, fontWeight: '700', color: theme.muted }}>
                    Chat is restricted on this account. Wallet features still work normally.
                </Text>
            </View>
        );
    }

    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                bounces
                alwaysBounceVertical
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ flexGrow: 1, paddingTop: headerHeight, paddingBottom: mainMenuHeight }}
                renderItem={renderItem}
                directionalLockEnabled
                alwaysBounceHorizontal={false}
                onEndReached={handleLoadMoreChats}
                onEndReachedThreshold={0.65}
                ListFooterComponent={() =>
                    !chatQuery && loadingMoreChats && items.length ? (
                        <View style={{ paddingVertical: 14, alignItems: 'center', justifyContent: 'center' }}>
                            <ActivityIndicator color={theme.muted} />
                        </View>
                    ) : null
                }
                ListEmptyComponent={() => {
                    if (chatQuery) {
                        return searching ? <EmptyState busy title="searching..." /> : <EmptyState icon={Search} title="no matches" detail="Try another username." />;
                    }

                    if (showLoadingChats) {
                        return <EmptyState busy />;
                    }

                    return <EmptyState title="no chats yet" detail="Use the search bar above to find people and start chatting." />;
                }}
            />
            <GlassHeader>
                <SearchInput
                    ref={searchInputRef}
                    value={search}
                    onChangeText={handleSearchChange}
                    onClear={handleClearSearch}
                    searching={searching}
                    glassEffectStyle="regular"
                    tintColor={theme.background}
                    style={{
                        zIndex: 1,
                        height: SEARCH_BAR_HEIGHT,
                    }}
                />
            </GlassHeader>
        </View>
    );
}
