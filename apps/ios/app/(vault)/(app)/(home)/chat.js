import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import * as Haptics from 'expo-haptics';
import { Search, Trash2 } from 'lucide-react-native';
import ReAnimated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
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
import Icon from '@/components/icon';
import { getMainMenuHeight } from '@/components/mainmenu';
import SearchInput from '@/components/search';
import { KeyboardChatScrollView } from '@/components/keyboardscroll';
import { useRouteLock } from '@/lib/navigation/routelock';
import { ScrollEdgeScreen } from '@/lib/navigation/scrolledge';
import { useTap } from '@/lib/tap';
import { formatUserDisplay } from '@veyl/shared/profile';
import { formatRowDateTime, timestampMs } from '@veyl/shared/utils/time';
import { getChatPeerPK } from '@veyl/shared/chat/ids';
import { getInsertedRowBatch, getMovedRowBatch, sameListIds } from '@veyl/shared/chat/listanimation';
import { getMsgPreview } from '@veyl/shared/chat/messages';
import { lowerText } from '@veyl/shared/utils/text';
import { cleanUsername } from '@veyl/shared/username';

const SEARCH_BAR_HEIGHT = 48;
const SEARCH_TOP_GAP = 0;
const SEARCH_LIST_GAP = 2;
const CHAT_ROW_HEIGHT = 71;
const DELETE_DRAG = 24;
const DELETE_HINT_W = 60;
const DELETE_TRIGGER = 80;
const DELETE_ICON_DELAY = 20;
const CHAT_ROW_APPEAR_MS = 640;
const CHAT_ROW_PHASE_MS = CHAT_ROW_APPEAR_MS / 2;
const CHAT_ROW_APPEAR_FROM = 0.98;
const MAX_CHAT_ANIMATED_INSERTS = 8;
const DELETE_SPRING = {
    mass: 0.16,
    stiffness: 200,
    damping: 4.5,
};

function clamp(value, min, max) {
    'worklet';
    return Math.min(Math.max(value, min), max);
}

function easeOutCubic(value) {
    'worklet';
    const t = clamp(value, 0, 1);
    return 1 - Math.pow(1 - t, 3);
}

function getItemIds(items) {
    return (items || []).map((item) => item?.id).filter(Boolean);
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

const StableChatAvatar = memo(function StableChatAvatar({ active, bot, uri }) {
    const source = useMemo(() => (uri ? { uri } : null), [uri]);
    return <Avatar source={source} active={active} bot={bot} />;
});

function ChatRow({ onPress, onDelete, title, subtitle, rightLabel, isUnseen, avatarUri, isActive, isBot, isLast = false, contentStyle = null, slotStyle = null }) {
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
                <StableChatAvatar uri={avatarUri} active={isActive} bot={isBot} />
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
                    <Text style={{ marginTop: 7, fontSize: 14, fontWeight: '700', color: isUnseen ? theme.foreground : theme.muted }} numberOfLines={1}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );

    if (typeof onDelete !== 'function') {
        return (
            <ReAnimated.View style={[{ overflow: 'hidden' }, slotStyle]}>
                <ReAnimated.View style={contentStyle}>{rowContent}</ReAnimated.View>
                {!isLast ? <View pointerEvents="none" style={{ height: 1, backgroundColor: theme.border }} /> : null}
            </ReAnimated.View>
        );
    }

    return (
        <ReAnimated.View style={[{ overflow: 'hidden' }, slotStyle]}>
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
            <ReAnimated.View style={contentStyle}>
                <GestureDetector gesture={deleteGesture}>
                    <ReAnimated.View collapsable={false} style={swipeMoveStyle}>
                        {rowContent}
                    </ReAnimated.View>
                </GestureDetector>
            </ReAnimated.View>
            {!isLast ? <View pointerEvents="none" style={{ height: 1, backgroundColor: theme.border }} /> : null}
        </ReAnimated.View>
    );
}

function useRowMoveStyles(animationKey, mode) {
    const progress = useSharedValue(mode ? 0 : 1);

    useEffect(() => {
        if (mode === 'in' || mode === 'out') {
            progress.value = 0;
            progress.value = withTiming(1, { duration: CHAT_ROW_PHASE_MS, easing: Easing.linear });
            return;
        }
        progress.value = 1;
    }, [animationKey, mode, progress]);

    const slotStyle = useAnimatedStyle(() => {
        if (mode === 'out') {
            const shrink = easeOutCubic((progress.value - 0.5) * 2);
            return { height: CHAT_ROW_HEIGHT * (1 - shrink) };
        }
        if (mode === 'in') {
            const grow = easeOutCubic(progress.value * 2);
            return { height: CHAT_ROW_HEIGHT * grow };
        }
        return {};
    });

    const contentStyle = useAnimatedStyle(() => {
        if (mode === 'out') {
            const fade = easeOutCubic(progress.value * 2);
            return {
                opacity: 1 - fade,
                transform: [{ scale: 1 - (1 - CHAT_ROW_APPEAR_FROM) * fade }],
            };
        }
        if (mode === 'in') {
            const fade = easeOutCubic((progress.value - 0.5) * 2);
            return {
                opacity: fade,
                transform: [{ scale: CHAT_ROW_APPEAR_FROM + (1 - CHAT_ROW_APPEAR_FROM) * fade }],
            };
        }
        return {
            opacity: 1,
            transform: [{ scale: 1 }],
        };
    });

    return { contentStyle, slotStyle };
}

function samePreviewMsg(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
        a.cid === b.cid &&
        a.sourceKey === b.sourceKey &&
        timestampMs(a.sourceTs) === timestampMs(b.sourceTs) &&
        a.id === b.id &&
        a.s === b.s &&
        a.from === b.from &&
        a.t === b.t &&
        a.c === b.c &&
        a.a === b.a &&
        a.tx === b.tx &&
        a.paidBy === b.paidBy &&
        a.sys === b.sys &&
        a.retention === b.retention &&
        a.target === b.target &&
        a.upto === b.upto &&
        a.emoji === b.emoji &&
        a.actionOp === b.actionOp &&
        a.actionTarget === b.actionTarget &&
        a.activity?.kind === b.activity?.kind &&
        timestampMs(a.activity?.at) === timestampMs(b.activity?.at) &&
        a.activity?.by === b.activity?.by &&
        timestampMs(a.contentUntil) === timestampMs(b.contentUntil) &&
        timestampMs(a.ttl) === timestampMs(b.ttl) &&
        timestampMs(a.editedAt) === timestampMs(b.editedAt) &&
        timestampMs(a.paidAt) === timestampMs(b.paidAt) &&
        a.pending === b.pending &&
        a.failed === b.failed
    );
}

function sameChatRow(prevChat, nextChat) {
    if (prevChat === nextChat) return true;
    if (!prevChat || !nextChat) return false;
    return (
        prevChat.id === nextChat.id &&
        prevChat.ts === nextChat.ts &&
        prevChat.unseen === nextChat.unseen &&
        prevChat.settings?.retention === nextChat.settings?.retention &&
        samePreviewMsg(prevChat.preview, nextChat.preview)
    );
}

function samePeerProfile(prevProps, nextProps) {
    const prevPeerChatPK = getChatPeerPK(prevProps.chat, prevProps.chatPK);
    const nextPeerChatPK = getChatPeerPK(nextProps.chat, nextProps.chatPK);
    if (prevPeerChatPK !== nextPeerChatPK) {
        return false;
    }
    const prevProfile = prevPeerChatPK ? prevProps.peerByChatPK?.get(prevPeerChatPK) : null;
    const nextProfile = nextPeerChatPK ? nextProps.peerByChatPK?.get(nextPeerChatPK) : null;
    return (
        prevProfile?.username === nextProfile?.username &&
        prevProfile?.avatar === nextProfile?.avatar &&
        prevProfile?.active === nextProfile?.active &&
        prevProfile?.bot === nextProfile?.bot
    );
}

function profileSignature(profile) {
    if (!profile) return '';
    return [profile.uid || '', profile.username || '', profile.avatar || '', profile.active ? '1' : '0', profile.bot || '', profile.chatPK || ''].join(':');
}

const ChatListChatRow = memo(function ChatListChatRow({ animationKey = '', chat, chatPK, handleDeleteChat, isLast, mode = null, openChat, peerByChatPK, previewNow, settings }) {
    const { contentStyle, slotStyle } = useRowMoveStyles(animationKey, mode);
    const peerChatPK = getChatPeerPK(chat, chatPK);
    const profile = peerChatPK ? peerByChatPK?.get(peerChatPK) : null;
    const title = formatUserDisplay({ username: profile?.username, chatPK: peerChatPK });
    const subtitle = getMsgPreview(chat?.preview, chatPK, settings, null, { now: previewNow });
    const lastMs = chat?.ts || null;
    const rightLabel = lastMs ? formatRowDateTime(lastMs, previewNow) : '';

    return (
        <ChatRow
            title={title}
            subtitle={subtitle}
            rightLabel={rightLabel}
            isUnseen={!!chat?.unseen}
            avatarUri={profile?.avatar || ''}
            isActive={!!profile?.active}
            isBot={!!profile?.bot}
            isLast={isLast}
            contentStyle={mode ? contentStyle : null}
            slotStyle={mode ? slotStyle : null}
            onPress={() => openChat(peerChatPK)}
            onDelete={() => handleDeleteChat(chat.id)}
        />
    );
}, (prev, next) => (
    prev.animationKey === next.animationKey &&
    prev.mode === next.mode &&
    prev.isLast === next.isLast &&
    prev.chatPK === next.chatPK &&
    prev.settings === next.settings &&
    prev.previewNow === next.previewNow &&
    sameChatRow(prev.chat, next.chat) &&
    samePeerProfile(prev, next)
));

export default function ChatList() {
    const { theme } = useTheme();
    const focused = useIsFocused();
    const navigation = useNavigation();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { chats, isChatDataReady, hasMoreChats, loadingMoreChats, loadMoreChats, previewNow, deleteChat, restoreDeletedChat } = useChat();
    const { chatPK, blockedSet, chatBanned, settings } = useUser();
    const { peers, peerByChatPK, isBlockedChatPK, isPeerDataReady } = usePeer() || {};
    const { searching, results, query, search: runSearch, clearSearch } = useSearch('profiles');
    const { lockRoute } = useRouteLock();
    const searchInputRef = useRef(null);
    const listRef = useRef(null);
    const stableChatItemsRef = useRef([]);
    const pendingChatItemsRef = useRef(null);
    const rowMoveRef = useRef(null);
    const rowMoveKeyRef = useRef(0);
    const [search, setSearch] = useState('');
    const [rowMove, setRowMove] = useState(null);
    const searchTop = insets.top + SEARCH_TOP_GAP;
    const searchBottom = searchTop + SEARCH_BAR_HEIGHT;
    const mainMenuHeight = getMainMenuHeight(insets.bottom);
    const listTopSpace = searchBottom + SEARCH_LIST_GAP;
    const listIndicatorInsets = useMemo(() => ({ top: searchBottom, bottom: mainMenuHeight }), [mainMenuHeight, searchBottom]);

    const chatQuery = useMemo(() => lowerText(search), [search]);
    const usernameQuery = useMemo(() => cleanUsername(search), [search]);
    const usernamePrefixSearch = chatQuery.startsWith('@');

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
            const preview = lowerText(getMsgPreview(chat?.preview, chatPK, settings, null, { now: previewNow }));
            const peerKey = lowerText(peerChatPK);
            const usernameMatch = usernameQuery ? (usernamePrefixSearch ? username.startsWith(usernameQuery) : username.includes(usernameQuery)) : false;

            return title.includes(chatQuery) || usernameMatch || atUsername.includes(chatQuery) || preview.includes(chatQuery) || peerKey.includes(chatQuery);
        });
    }, [chatPK, chatQuery, chats, hasBlockedUsers, isBlockedChatPK, isPeerDataReady, peerByChatPK, previewNow, settings, usernamePrefixSearch, usernameQuery]);

    const chatPeerPKs = useMemo(() => new Set((Array.isArray(chats) ? chats : []).map((chat) => chat?.peerChatPK).filter(Boolean)), [chats]);

    const searchPeers = useMemo(() => {
        if (!query || !chatPK) return [];
        const merged = mergeProfiles({
            local: peers || [],
            remote: results || [],
            parsed: query,
            extraFilter: (peer) => {
                if (!peer?.chatPK || peer.chatPK === chatPK) return false;
                return !chatPeerPKs.has(peer.chatPK);
            },
        });
        return merged.map((peer) => {
            const key = peer.uid || peer.chatPK || peer.walletPK;
            return { id: `peer:${key}`, peer, peerChatPK: peer.chatPK, type: 'peer' };
        });
    }, [chatPeerPKs, chatPK, peers, query, results]);

    const chatItems = useMemo(() => filteredChats.map((chat) => ({ id: chat.id, chat, type: 'chat' })), [filteredChats]);
    const items = useMemo(() => [...chatItems, ...searchPeers], [chatItems, searchPeers]);
    const peerListSignature = useMemo(
        () =>
            items
                .map((item) => {
                    if (item.type === 'peer') return `${item.id}:${profileSignature(item.peer)}`;
                    const peerChatPK = getChatPeerPK(item.chat, chatPK);
                    return `${item.id}:${profileSignature(peerChatPK ? peerByChatPK?.get(peerChatPK) : null)}`;
                })
                .join('|'),
        [chatPK, items, peerByChatPK]
    );
    const listExtraData = `${peerListSignature}:${settings?.moneyFormat || ''}:${settings?.showChatPreviews === false ? 'hide' : 'show'}`;

    const createRowMove = useCallback((previousItems, nextItems) => {
        const previousIds = getItemIds(previousItems);
        const nextIds = getItemIds(nextItems);
        const batch = getMovedRowBatch(previousIds, nextIds);
        if (!batch) {
            const insertBatch = getInsertedRowBatch(previousIds, nextIds);
            if (!insertBatch || insertBatch.ids.length > MAX_CHAT_ANIMATED_INSERTS) {
                return null;
            }
            rowMoveKeyRef.current += 1;
            return {
                ...insertBatch,
                key: `${rowMoveKeyRef.current}:insert:${insertBatch.ids.join(',')}`,
                phase: 'entering',
                previousItems,
                nextItems,
            };
        }
        rowMoveKeyRef.current += 1;
        return {
            ...batch,
            key: `${rowMoveKeyRef.current}:move:${batch.ids.join(',')}`,
            phase: 'leaving',
            previousItems,
            nextItems,
        };
    }, []);

    useLayoutEffect(() => {
        if (showLoadingChats) {
            stableChatItemsRef.current = [];
            pendingChatItemsRef.current = null;
            rowMoveRef.current = null;
            setRowMove(null);
            return;
        }

        if (chatQuery) {
            stableChatItemsRef.current = chatItems;
            pendingChatItemsRef.current = null;
            rowMoveRef.current = null;
            setRowMove(null);
            return;
        }

        if (rowMoveRef.current) {
            pendingChatItemsRef.current = chatItems;
            return;
        }

        const previousItems = stableChatItemsRef.current;
        const move = createRowMove(previousItems, chatItems);
        if (!move) {
            stableChatItemsRef.current = chatItems;
            pendingChatItemsRef.current = null;
            setRowMove(null);
            return;
        }

        rowMoveRef.current = move;
        pendingChatItemsRef.current = null;
        setRowMove(move);
    }, [chatItems, chatQuery, createRowMove, showLoadingChats]);

    useEffect(() => {
        if (!rowMove) {
            return;
        }

        const timeout = setTimeout(() => {
            setRowMove((current) => {
                if (current?.key !== rowMove.key) {
                    return current;
                }
                if (current.phase === 'leaving') {
                    const entering = { ...current, phase: 'entering' };
                    rowMoveRef.current = entering;
                    return entering;
                }

                const pendingItems = pendingChatItemsRef.current;
                pendingChatItemsRef.current = null;
                stableChatItemsRef.current = current.nextItems;

                if (pendingItems && !sameListIds(getItemIds(current.nextItems), getItemIds(pendingItems))) {
                    const nextMove = createRowMove(current.nextItems, pendingItems);
                    if (nextMove) {
                        rowMoveRef.current = nextMove;
                        return nextMove;
                    }
                }

                if (pendingItems) {
                    stableChatItemsRef.current = pendingItems;
                }
                rowMoveRef.current = null;
                return null;
            });
        }, CHAT_ROW_PHASE_MS);

        return () => {
            clearTimeout(timeout);
        };
    }, [createRowMove, rowMove]);

    const displayItems = useMemo(() => {
        if (!rowMove || chatQuery) {
            return items;
        }

        const movingIds = new Set(rowMove.ids);
        if (rowMove.phase === 'leaving') {
            return rowMove.previousItems.map((item) => (
                movingIds.has(item.id)
                    ? {
                          ...item,
                          animationKey: rowMove.key,
                          type: 'moving-chat-out',
                      }
                    : item
            ));
        }

        return rowMove.nextItems.map((item) => (
            item.type === 'chat' && movingIds.has(item.id)
                ? {
                      ...item,
                      animationKey: rowMove.key,
                      type: 'moving-chat-in',
                  }
                : item
        ));
    }, [chatQuery, items, rowMove]);

    const handleLoadMoreChats = useCallback(() => {
        if (chatQuery || !hasMoreChats || loadingMoreChats) {
            return;
        }
        void loadMoreChats?.();
    }, [chatQuery, hasMoreChats, loadingMoreChats, loadMoreChats]);

    const handleSearchChange = useCallback(
        (value) => {
            listRef.current?.scrollToOffset?.({ offset: -searchBottom, animated: false });
            setSearch(value);
            runSearch(value);
        },
        [runSearch, searchBottom]
    );

    const handleClearSearch = useCallback(() => {
        setSearch('');
        clearSearch();
    }, [clearSearch]);

    const focusSearchInput = useCallback(() => {
        searchInputRef.current?.focus?.();
    }, []);

    useEffect(() => {
        const unsubscribe = navigation.addListener('tabPress', () => {
            if (!focused) return;
            focusSearchInput();
        });

        return unsubscribe;
    }, [focusSearchInput, focused, navigation]);

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
            const isLast = index === displayItems.length - 1;
            if (item.type === 'peer') {
                const profile = item.peer;
                const title = formatUserDisplay({ username: profile?.username, chatPK: profile?.chatPK, walletPK: profile?.walletPK });

                return (
                    <ChatRow
                        title={title}
                        subtitle="start chat"
                        rightLabel="new"
                        isUnseen={false}
                        avatarUri={profile?.avatar || ''}
                        isActive={!!profile?.active}
                        isBot={!!profile?.bot}
                        isLast={isLast}
                        onPress={() => openChat(item.peerChatPK)}
                    />
                );
            }

            return (
                <ChatListChatRow
                    animationKey={item.animationKey || ''}
                    chat={item.chat}
                    chatPK={chatPK}
                    handleDeleteChat={handleDeleteChat}
                    isLast={isLast}
                    mode={item.type === 'moving-chat-in' ? 'in' : item.type === 'moving-chat-out' ? 'out' : null}
                    openChat={openChat}
                    peerByChatPK={peerByChatPK}
                    previewNow={previewNow}
                    settings={settings}
                />
            );
        },
        [chatPK, displayItems.length, handleDeleteChat, openChat, peerByChatPK, previewNow, settings]
    );

    const renderScrollComponent = useCallback(
        (props) => <KeyboardChatScrollView {...props} bottomOffset={mainMenuHeight} keyboardLiftBehavior="never" />,
        [mainMenuHeight]
    );

    const getItemLayout = useCallback(
        (_data, index) => ({
            length: CHAT_ROW_HEIGHT,
            offset: listTopSpace + CHAT_ROW_HEIGHT * index,
            index,
        }),
        [listTopSpace]
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
            <ScrollEdgeScreen>
                <FlatList
                    ref={listRef}
                    data={displayItems}
                    keyExtractor={(item) => item.id}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                    keyboardDismissMode="interactive"
                    keyboardShouldPersistTaps="handled"
                    scrollIndicatorInsets={listIndicatorInsets}
                    contentContainerStyle={{ flexGrow: 1, paddingTop: listTopSpace, paddingBottom: mainMenuHeight }}
                    renderItem={renderItem}
                    extraData={listExtraData}
                    getItemLayout={getItemLayout}
                    initialNumToRender={16}
                    maxToRenderPerBatch={12}
                    removeClippedSubviews
                    updateCellsBatchingPeriod={24}
                    windowSize={8}
                    directionalLockEnabled
                    alwaysBounceHorizontal={false}
                    onEndReached={handleLoadMoreChats}
                    onEndReachedThreshold={0.65}
                    renderScrollComponent={renderScrollComponent}
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
            </ScrollEdgeScreen>
            <View
                style={{
                    paddingHorizontal: 14,
                    position: 'absolute',
                    top: searchTop,
                    left: 0,
                    right: 0,
                    zIndex: 2,
                }}
            >
                <SearchInput
                    ref={searchInputRef}
                    value={search}
                    onChangeText={handleSearchChange}
                    onClear={handleClearSearch}
                    searching={searching}
                    style={{
                        zIndex: 1,
                    }}
                />
            </View>
        </View>
    );
}
