import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { Easing, scrollTo, useAnimatedRef, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownLeft, ArrowUpRight, MessageCircle, Search } from 'lucide-react-native';
import { mergeProfiles } from '@veyl/shared/search/merge';
import { yieldToUi } from '@veyl/shared/utils/async';
import { MONEY_UNITS, toDisplay, toSats } from '@veyl/shared/money';
import { formatUserDisplay, peerKey } from '@veyl/shared/profile';
import { truncateLabel } from '@veyl/shared/utils/display';
import { getChatId } from '@veyl/shared/crypto/chat';
import { makeReq } from '@veyl/shared/chat/messages';
import { BTC_PRICE_FALLBACK, REQUEST_MONEY_MAX_SATS } from '@veyl/shared/config';
import { availableBalanceSats } from '@veyl/shared/wallet/balance';

import { useBitcoin } from '@/providers/bitcoinprovider';
import { useTheme } from '@/providers/themeprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { useChat } from '@/providers/chatprovider';
import { useSearch } from '@/lib/search/usesearch';
import Avatar from '@/components/avatar';
import EmptyState from '@/components/emptystate';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import GlassIcon from '@/components/glass/glassicon';
import Icon from '@/components/icon';
import SearchInput from '@/components/search';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from '@/components/keyboardscroll';
import { tap } from '@/lib/tap';
import { useRouteLock } from '@/lib/navigation/routelock';

const FOOTER_OFFSCREEN = 260;
const FOOTER_HEIGHT_FALLBACK = 122;
const FOOTER_LIST_CLEARANCE = 12;
const FOOTER_SCROLL_RELAX = 8;
const FOOTER_KEYBOARD_GAP = 8;
const FOOTER_PRELOAD_SCALE = 0.001;
const FOOTER_ANIMATION_MS = 220;
const FOOTER_KEYBOARD_CLOSE_MAX_EXTRA_MS = 140;
const FOOTER_KEYBOARD_CLOSE_MS_PER_PX = 0.35;
const FOOTER_EASING = Easing.out(Easing.cubic);
const FOOTER_CLOSE_EASING = Easing.inOut(Easing.cubic);
const PEER_ROW_HEIGHT_FALLBACK = 112;
const LIST_CROP_TOP = 20;
const LIST_CONTENT_TOP = 18 + 24;
const LIST_DEFAULT_BOTTOM_GAP = 12;

function samePeer(a, b) {
    if (!a || !b) return false;
    if (a.uid && b.uid) return a.uid === b.uid;
    if (a.chatPK && b.chatPK) return a.chatPK === b.chatPK;
    if (a.walletPK && b.walletPK) return a.walletPK === b.walletPK;
    return false;
}

const PeerCell = memo(function PeerCell({ item, onSelect, theme, selected, disabled }) {
    const scale = useSharedValue(1);
    const pressFeedback = tap({
        value: scale,
        disabled,
        onPress: () => !disabled && onSelect?.(item),
    });

    const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    const avatar = useMemo(() => (item?.avatar ? { uri: item.avatar } : null), [item?.avatar]);
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
}, arePeerCellsEqual);

function arePeerCellsEqual(prev, next) {
    return (
        prev.item?.uid === next.item?.uid &&
        prev.item?.avatar === next.item?.avatar &&
        prev.item?.active === next.item?.active &&
        prev.item?.bot === next.item?.bot &&
        prev.selected === next.selected &&
        prev.disabled === next.disabled &&
        prev.onSelect === next.onSelect &&
        prev.theme?.foreground === next.theme?.foreground
    );
}

export default function PeerSelectorScreen() {
    const { theme } = useTheme();
    const { peers, recentPeers } = usePeer() || {};
    const { settings, chatPK, chatBanned } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, balance } = useWallet();
    const { sendMessage, selectChat } = useChat();
    const { searching, results, query, search: runSearch, clearSearch } = useSearch('profiles');
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

    const searchInputRef = useRef(null);
    const amountInputRef = useRef(null);
    const listRef = useAnimatedRef();
    const listHeightRef = useRef(0);
    const listScrollYRef = useRef(0);
    const footerHeightRef = useRef(FOOTER_HEIGHT_FALLBACK);
    const filteredPeersRef = useRef([]);
    const activePeer = useRef(null);
    const openRef = useRef(true);
    const busyRef = useRef(false);
    const { lockRoute } = useRouteLock();

    const [selectedPeer, setSelectedPeer] = useState(null);
    const [footerPeer, setFooterPeer] = useState(null);
    const [amount, setAmount] = useState('');
    const [inputUnit, setInputUnit] = useState(settings?.moneyFormat || 'sats');
    const [overlayVisible, setOverlayVisible] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [search, setSearch] = useState('');
    const [mode, setMode] = useState('send');

    const cycleScale = useSharedValue(1);
    const footerLive = useSharedValue(0);
    const footerProgress = useSharedValue(0);
    const footerReserve = useSharedValue(FOOTER_HEIGHT_FALLBACK + FOOTER_LIST_CLEARANCE);
    const linkedScrollBase = useSharedValue(0);
    const linkedScrollDelta = useSharedValue(0);
    const linkedScrollActive = useSharedValue(0);

    useDerivedValue(() => {
        if (!linkedScrollActive.value) {
            return;
        }

        scrollTo(listRef, 0, Math.max(0, linkedScrollBase.value + linkedScrollDelta.value * footerProgress.value), false);
    });

    useEffect(() => {
        return () => {
            openRef.current = false;
            clearSearch();
        };
    }, [clearSearch]);

    useEffect(() => {
        if (chatBanned) {
            setMode('send');
        }
    }, [chatBanned]);

    const pickPeer = useCallback((peer) => {
        activePeer.current = peer;
        setSelectedPeer(peer);
    }, []);

    const resetOverlay = useCallback(() => {
        setOverlayVisible(false);
        pickPeer(null);
        setFooterPeer(null);
        setAmount('');
        setInputUnit(settings?.moneyFormat || 'sats');
    }, [pickPeer, settings?.moneyFormat]);

    const finishClose = useCallback(() => {
        if (activePeer.current) return;
        resetOverlay();
    }, [resetOverlay]);

    const getFooterHeight = useCallback(() => Math.max(0, footerHeightRef.current || FOOTER_HEIGHT_FALLBACK), []);
    const getFooterReserveHeight = useCallback(() => getFooterHeight() + FOOTER_LIST_CLEARANCE, [getFooterHeight]);
    const getFooterCloseDuration = useCallback(() => {
        const metricHeight = Math.max(0, Number(Keyboard.metrics?.()?.height) || 0);
        const animatedHeight = Math.max(0, -(Number(keyboardHeight.value) || 0));
        const keyboardLift = Math.max(metricHeight, animatedHeight);
        if (keyboardLift <= 0) return FOOTER_ANIMATION_MS;
        return FOOTER_ANIMATION_MS + Math.min(FOOTER_KEYBOARD_CLOSE_MAX_EXTRA_MS, Math.round(keyboardLift * FOOTER_KEYBOARD_CLOSE_MS_PER_PX));
    }, [keyboardHeight]);

    const getPeerFooterDelta = useCallback(
        (peer) => {
            const listHeight = listHeightRef.current;
            const footerHeight = getFooterHeight();
            if (!peer || listHeight <= 0 || footerHeight <= 0) return 0;

            const index = filteredPeersRef.current.findIndex((item) => samePeer(item, peer));
            if (index < 0) return 0;

            const rowBottom = LIST_CONTENT_TOP + (Math.floor(index / 3) + 1) * PEER_ROW_HEIGHT_FALLBACK;
            const currentOffset = Math.max(0, listScrollYRef.current);
            const selectedBottom = rowBottom - currentOffset;
            const footerTop = listHeight - insets.bottom - footerHeight - FOOTER_LIST_CLEARANCE + FOOTER_SCROLL_RELAX;

            return Math.max(0, selectedBottom - footerTop);
        },
        [getFooterHeight, insets.bottom]
    );

    const startLinkedFooterOpen = useCallback(
        (peer) => {
            const delta = getPeerFooterDelta(peer);
            footerLive.value = 1;
            footerReserve.value = getFooterReserveHeight();
            linkedScrollBase.value = Math.max(0, listScrollYRef.current);
            linkedScrollDelta.value = delta;
            linkedScrollActive.value = delta > 0 ? 1 : 0;
            footerProgress.value = 0;
            footerProgress.value = withTiming(1, { duration: FOOTER_ANIMATION_MS, easing: FOOTER_EASING }, () => {
                linkedScrollActive.value = 0;
            });
        },
        [footerLive, footerProgress, footerReserve, getFooterReserveHeight, getPeerFooterDelta, linkedScrollActive, linkedScrollBase, linkedScrollDelta]
    );

    const scrollPeerAboveFooter = useCallback(
        (peer) => {
            if (!samePeer(activePeer.current, peer)) return;
            const delta = getPeerFooterDelta(peer);
            if (delta <= 0) return;

            listRef.current?.scrollToOffset?.({
                offset: Math.max(0, listScrollYRef.current + delta),
                animated: true,
            });
        },
        [getPeerFooterDelta, listRef]
    );

    const closePanel = useCallback(() => {
        const closeDuration = getFooterCloseDuration();
        linkedScrollActive.value = 0;
        footerProgress.value = withTiming(0, { duration: closeDuration, easing: FOOTER_CLOSE_EASING }, (done) => {
            if (done) {
                footerLive.value = 0;
                scheduleOnRN(finishClose);
            }
        });
    }, [finishClose, footerLive, footerProgress, getFooterCloseDuration, linkedScrollActive]);

    const handleSelectPeer = useCallback(
        (nextPeer) => {
            const current = activePeer.current;
            if (samePeer(current, nextPeer)) {
                pickPeer(null);

                searchInputRef.current?.blur();
                amountInputRef.current?.blur();
                closePanel();
                return;
            }

            searchInputRef.current?.blur();
            const isFirst = !current;
            setFooterPeer(nextPeer);
            pickPeer(nextPeer);
            setAmount('');
            setInputUnit(settings?.moneyFormat || 'sats');

            if (isFirst) {
                setOverlayVisible(true);
                startLinkedFooterOpen(nextPeer);
            } else {
                scrollPeerAboveFooter(nextPeer);
            }
        },
        [closePanel, pickPeer, scrollPeerAboveFooter, settings?.moneyFormat, startLinkedFooterOpen]
    );

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

    const closeRoute = useCallback(async () => {
        searchInputRef.current?.blur?.();
        amountInputRef.current?.blur?.();
        Keyboard.dismiss();
        await yieldToUi();
        if (!openRef.current) return;
        router.dismiss();
    }, [router]);

    const cycleUnit = useCallback(() => {
        const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
        const idx = MONEY_UNITS.indexOf(inputUnit);
        const next = MONEY_UNITS[(idx + 1) % MONEY_UNITS.length];
        if (amount) {
            const sats = toSats(amount, inputUnit, price);
            setAmount(sats === 0n ? '' : toDisplay(sats, next, price));
        }
        setInputUnit(next);
    }, [amount, bitcoin?.price, inputUnit]);

    const validSats = useMemo(() => {
        if (!amount) return 0n;
        const price = bitcoin?.price ?? BTC_PRICE_FALLBACK;
        const max = mode === 'request' ? REQUEST_MONEY_MAX_SATS : availableBalanceSats(balance);
        try {
            const sats = toSats(amount, inputUnit, price);
            if (sats <= 0n || sats > max) return 0n;
            return sats;
        } catch {
            return 0n;
        }
    }, [amount, balance, bitcoin?.price, inputUnit, mode]);

    const filteredPeers = useMemo(() => {
        const list = Array.isArray(peers) ? peers : [];
        const recent = Array.isArray(recentPeers?.all) ? recentPeers.all : [];
        const requireWalletAndChat = (peer) => mode !== 'request' || (!!peer.walletPK && !!peer.chatPK);
        if (!search.trim()) return recent.filter(requireWalletAndChat);
        if (!query) return [];
        return mergeProfiles({
            local: list,
            remote: results || [],
            parsed: query,
            extraFilter: requireWalletAndChat,
        });
    }, [mode, peers, query, recentPeers?.all, results, search]);
    filteredPeersRef.current = filteredPeers;

    const handleOpenChat = useCallback(() => {
        if (chatBanned) return;
        if (!selectedPeer?.chatPK || !chatPK) return;
        if (!lockRoute()) return;
        const chatId = getChatId(chatPK, selectedPeer.chatPK);
        selectChat?.(chatId);
        router.replace({ pathname: '/chat/[peerchatpk]', params: { peerchatpk: selectedPeer.chatPK } });
    }, [chatBanned, chatPK, lockRoute, router, selectChat, selectedPeer]);

    const toggleMode = useCallback(() => {
        if (isSending || chatBanned) return;
        setMode((current) => (current === 'send' ? 'request' : 'send'));
    }, [chatBanned, isSending]);

    const handleSend = useCallback(() => {
        if (isSending || validSats <= 0n || busyRef.current) return;

        if (mode === 'request') {
            const peerChatPK = selectedPeer?.chatPK;
            if (!peerChatPK) {
                Alert.alert('Chat unavailable', 'This person cannot receive requests yet.');
                return;
            }

            amountInputRef.current?.blur();
            busyRef.current = true;
            setIsSending(true);
            void closeRoute();

            const message = makeReq(validSats.toString());
            sendMessage(peerChatPK, message)
                .catch((error) => {
                    Alert.alert('Request failed', error?.message || 'Failed to send request.');
                })
                .finally(() => {
                    if (!openRef.current) return;
                    busyRef.current = false;
                    setIsSending(false);
                });
            return;
        }

        const receiverWalletPK = selectedPeer?.walletPK;
        if (!receiverWalletPK) {
            Alert.alert('Wallet unavailable', 'This person cannot receive money yet.');
            return;
        }

        amountInputRef.current?.blur();
        busyRef.current = true;
        setIsSending(true);
        void closeRoute();

        void sendMoneyWithSpark(receiverWalletPK, Number(validSats))
            .catch((error) => {
                Alert.alert('Send failed', error?.message || 'Failed to send.');
            })
            .finally(() => {
                if (!openRef.current) return;
                busyRef.current = false;
                setIsSending(false);
            });
    }, [closeRoute, isSending, mode, selectedPeer, sendMessage, sendMoneyWithSpark, validSats]);

    const handleListLayout = useCallback((event) => {
        listHeightRef.current = Math.round(event?.nativeEvent?.layout?.height || 0);
    }, []);
    const handleListScroll = useCallback((event) => {
        listScrollYRef.current = Math.max(0, Number(event?.nativeEvent?.contentOffset?.y) || 0);
    }, []);
    const handleFooterLayout = useCallback(
        (event) => {
            const height = Math.round(event?.nativeEvent?.layout?.height || 0);
            if (height <= 0 || height === footerHeightRef.current) return;
            footerHeightRef.current = height;
            footerReserve.value = height + FOOTER_LIST_CLEARANCE;
            if (overlayVisible) {
                scrollPeerAboveFooter(activePeer.current);
            }
        },
        [footerReserve, overlayVisible, scrollPeerAboveFooter]
    );

    const renderPeer = useCallback(
        ({ item }) => {
            const selected = samePeer(selectedPeer, item);
            return <PeerCell item={item} onSelect={handleSelectPeer} theme={theme} selected={selected} disabled={!item?.walletPK && !item?.chatPK} />;
        },
        [handleSelectPeer, selectedPeer, theme]
    );

    const keyExtractor = useCallback((item, index) => peerKey(item, `${index}`), []);
    const cycleStyle = useAnimatedStyle(() => ({ transform: [{ scale: cycleScale.value }] }));
    const slideStyle = useAnimatedStyle(() => {
        if (!footerLive.value && footerProgress.value <= 0) {
            return { transform: [{ scale: FOOTER_PRELOAD_SCALE }] };
        }

        return { transform: [{ translateY: FOOTER_OFFSCREEN * (1 - footerProgress.value) }, { scale: 1 }] };
    });
    const footerReserveStyle = useAnimatedStyle(() => ({ height: footerReserve.value * footerProgress.value + Math.max(0, -keyboardHeight.value - insets.bottom) }));
    const stickyOffset = useMemo(() => ({ closed: 0, opened: insets.bottom - FOOTER_KEYBOARD_GAP }), [insets.bottom]);
    const footerBottom = insets.bottom;
    const listBottomPadding = insets.bottom + LIST_DEFAULT_BOTTOM_GAP;
    const cyclePress = tap({ value: cycleScale, disabled: isSending, onPress: cycleUnit });
    const modeIcon = mode === 'request' ? ArrowDownLeft : ArrowUpRight;
    const displayPeer = selectedPeer || footerPeer;
    const footerInteractive = overlayVisible && !!selectedPeer && !isSending;
    const sendLabel =
        mode === 'request'
            ? isSending
                ? 'requesting...'
                : displayPeer
                  ? `request from ${formatUserDisplay(displayPeer, false)}`
                  : 'request'
            : isSending
              ? 'sending...'
              : displayPeer
                ? `send to ${formatUserDisplay(displayPeer, false)}`
                : 'send';
    const sendDisabled = !validSats || isSending || (mode === 'request' ? chatBanned || !displayPeer?.chatPK : !displayPeer?.walletPK);
    const amountPlaceholder = inputUnit === 'sats' ? '0000' : '0.00';

    return (
        <View style={{ flex: 1, overflow: 'hidden', paddingHorizontal: 12 }}>
            <View
                style={{
                    paddingHorizontal: 16,
                    position: 'absolute',
                    top: 18,
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
                    glassEffectStyle="regular"
                    style={{
                        zIndex: 1,
                    }}
                />
            </View>
            <View onLayout={handleListLayout} style={{ position: 'absolute', top: LIST_CROP_TOP, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
                <Animated.FlatList
                    ref={listRef}
                    data={filteredPeers}
                    keyExtractor={keyExtractor}
                    renderItem={renderPeer}
                    numColumns={3}
                    keyboardDismissMode="interactive"
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ flexGrow: 1, paddingTop: LIST_CONTENT_TOP, paddingBottom: listBottomPadding }}
                    style={{ flex: 1 }}
                    onScroll={handleListScroll}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                    automaticallyAdjustContentInsets={false}
                    automaticallyAdjustsScrollIndicatorInsets={false}
                    contentInsetAdjustmentBehavior="never"
                    ListFooterComponent={<Animated.View pointerEvents="none" style={footerReserveStyle} />}
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

                <KeyboardStickyView offset={stickyOffset} style={{ position: 'absolute', left: 0, right: 0, bottom: footerBottom, zIndex: 2 }} pointerEvents="box-none">
                    <Animated.View
                        onLayout={handleFooterLayout}
                        pointerEvents={footerInteractive ? 'box-none' : 'none'}
                        accessibilityElementsHidden={!footerInteractive}
                        importantForAccessibility={footerInteractive ? 'auto' : 'no-hide-descendants'}
                        style={[{ paddingHorizontal: 14, gap: 12 }, slideStyle]}
                    >
                        <GlassField disabled={isSending} style={{ flex: 1, paddingHorizontal: 16 }}>
                            <TextInput
                                ref={amountInputRef}
                                value={amount}
                                placeholder={amountPlaceholder}
                                placeholderTextColor={theme.muted}
                                keyboardType="numeric"
                                onChangeText={setAmount}
                                editable={overlayVisible && !isSending}
                                style={{ flex: 1, fontSize: 24, fontWeight: '900', color: theme.foreground, paddingVertical: 10 }}
                            />
                            <Pressable {...cyclePress} hitSlop={8} disabled={isSending}>
                                <Animated.View style={[{ paddingLeft: 12, alignItems: 'center', justifyContent: 'center' }, cycleStyle]}>
                                    {inputUnit === 'btc' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>₿</Text>}
                                    {inputUnit === 'usd' && <Text style={{ fontSize: 24, fontWeight: '900', color: theme.muted }}>$</Text>}
                                    {inputUnit === 'sats' && <Text style={{ marginBottom: 2, fontSize: 24, fontWeight: '900', color: theme.muted }}>sats</Text>}
                                </Animated.View>
                            </Pressable>
                        </GlassField>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <GlassIcon icon={modeIcon} iconSize={32} onPress={toggleMode} disabled={isSending || chatBanned} />
                            <GlassButton onPress={handleSend} label={sendLabel} accent disabled={sendDisabled} pressableStyle={{ flex: 1 }} />
                            <GlassIcon icon={MessageCircle} onPress={handleOpenChat} disabled={!displayPeer?.chatPK || isSending || chatBanned} />
                        </View>
                    </Animated.View>
                </KeyboardStickyView>
            </View>
        </View>
    );
}
