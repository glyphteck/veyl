import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { Easing, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownLeft, ArrowUpRight, MessageCircle, Search } from 'lucide-react-native';
import { mergeProfiles } from '@glyphteck/shared/search/merge';
import { toSats, toDisplay, formatUserDisplay, satsInABitcoin } from '@glyphteck/shared/utils';
import { getChatId } from '@glyphteck/shared/crypto/chat';
import { makeReq } from '@glyphteck/shared/chat/messages';

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
import { getKeyboardOffset, KeyboardGestureArea, KeyboardListScrollView, KeyboardStickyView, useReanimatedKeyboardAnimation } from '@/components/keyboardscroll';
import { tap } from '@/lib/tap';

const UNITS = ['sats', 'btc', 'usd'];
const FOOTER_OFFSCREEN = 260;
const FOOTER_CONTENT_HEIGHT = 98;
const MAX_REQUEST_AMOUNT = satsInABitcoin * 100000n;
const INPUT_ID = 'peer-footer-input';

function getPeerLabel(peer) {
    if (!peer) return '';
    return peer?.username || formatUserDisplay({ username: peer?.username, chatPK: peer?.chatPK, walletPK: peer?.walletPK });
}

function truncateLabel(label, max = 8) {
    if (!label || label.length <= max) return label || '';
    return `${label.slice(0, max)}…`;
}

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
        hapticIn: 'selection',
    });

    const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    const avatar = useMemo(() => (item?.avatar ? { uri: item.avatar } : null), [item?.avatar]);
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

const PeerScroll = forwardRef(function PeerScroll({ pad, ...props }, ref) {
    return (
        <KeyboardListScrollView
            ref={ref}
            {...props}
            bounces
            alwaysBounceVertical
            keyboardDismissMode="interactive"
            keyboardLiftBehavior="never"
            extraContentPadding={pad}
        />
    );
});

export default function PeerSelectorScreen() {
    const { theme } = useTheme();
    const { peers } = usePeer() || {};
    const { settings, chatPK, chatBanned } = useUser();
    const { sendMoneyWithSpark, balance, bitcoin } = useWallet();
    const { sendMessage, selectChat } = useChat();
    const { searching, results, query, search: runSearch, clearSearch } = useSearch('profiles');
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

    const searchInputRef = useRef(null);
    const amountInputRef = useRef(null);
    const activePeer = useRef(null);
    const openRef = useRef(true);
    const busyRef = useRef(false);
    const routeLockRef = useRef(false);
    const routeLockTimerRef = useRef(null);
    const keyboardVisibleRef = useRef(false);
    const keyboardTransitionUntilRef = useRef(0);
    const sheetHeightRef = useRef(null);

    const [selectedPeer, setSelectedPeer] = useState(null);
    const [amount, setAmount] = useState('');
    const [inputUnit, setInputUnit] = useState(settings?.moneyFormat || 'sats');
    const [overlayVisible, setOverlayVisible] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [search, setSearch] = useState('');
    const [mode, setMode] = useState('send');

    const cycleScale = useSharedValue(1);
    const translateY = useSharedValue(FOOTER_OFFSCREEN);

    useEffect(() => {
        return () => {
            openRef.current = false;
            clearSearch();
            if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        };
    }, [clearSearch]);

    useEffect(() => {
        if (chatBanned) {
            setMode('send');
        }
    }, [chatBanned]);

    const lockRoute = useCallback((ms = 1200) => {
        if (routeLockRef.current) return false;
        routeLockRef.current = true;
        if (routeLockTimerRef.current) clearTimeout(routeLockTimerRef.current);
        routeLockTimerRef.current = setTimeout(() => {
            routeLockRef.current = false;
            routeLockTimerRef.current = null;
        }, ms);
        return true;
    }, []);

    useEffect(() => {
        const markKeyboardTransition = () => {
            keyboardTransitionUntilRef.current = Date.now() + 350;
        };
        const handleKeyboardWillShow = () => {
            keyboardVisibleRef.current = true;
            markKeyboardTransition();
        };
        const handleKeyboardWillHide = () => {
            keyboardVisibleRef.current = false;
            markKeyboardTransition();
        };
        const handleKeyboardDidShow = () => {
            keyboardVisibleRef.current = true;
            markKeyboardTransition();
        };
        const handleKeyboardDidHide = () => {
            keyboardVisibleRef.current = false;
            markKeyboardTransition();
        };

        const subscriptions = [
            Keyboard.addListener('keyboardWillShow', handleKeyboardWillShow),
            Keyboard.addListener('keyboardWillHide', handleKeyboardWillHide),
            Keyboard.addListener('keyboardDidShow', handleKeyboardDidShow),
            Keyboard.addListener('keyboardDidHide', handleKeyboardDidHide),
        ];

        return () => {
            for (const subscription of subscriptions) {
                subscription.remove();
            }
        };
    }, []);

    const pickPeer = useCallback((peer) => {
        activePeer.current = peer;
        setSelectedPeer(peer);
    }, []);

    const resetOverlay = useCallback(() => {
        setOverlayVisible(false);
        pickPeer(null);
        setAmount('');
        setInputUnit(settings?.moneyFormat || 'sats');
    }, [pickPeer, settings?.moneyFormat]);

    const finishClose = useCallback(() => {
        if (activePeer.current) return;
        resetOverlay();
    }, [resetOverlay]);

    const closePanel = useCallback(() => {
        translateY.value = withTiming(FOOTER_OFFSCREEN, { duration: 220, easing: Easing.out(Easing.cubic) }, (done) => {
            if (done) scheduleOnRN(finishClose);
        });
    }, [finishClose, translateY]);

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
            pickPeer(nextPeer);
            setAmount('');
            setInputUnit(settings?.moneyFormat || 'sats');

            if (isFirst) {
                setOverlayVisible(true);
                translateY.value = FOOTER_OFFSCREEN;
                translateY.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
            }
        },
        [closePanel, pickPeer, settings?.moneyFormat, translateY]
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

    const handleSearchFocus = useCallback(() => {
        if (!activePeer.current || isSending) return;
        amountInputRef.current?.blur();
        pickPeer(null);
        closePanel();
    }, [closePanel, isSending, pickPeer]);

    const handleSheetLayout = useCallback((event) => {
        const nextHeight = Math.round(event.nativeEvent.layout.height);
        const previousHeight = sheetHeightRef.current;
        sheetHeightRef.current = nextHeight;

        if (previousHeight == null || previousHeight === nextHeight) return;
        if (!keyboardVisibleRef.current) return;
        if (Date.now() < keyboardTransitionUntilRef.current) return;

        searchInputRef.current?.blur();
        amountInputRef.current?.blur();
    }, []);

    const closeRoute = useCallback(async () => {
        searchInputRef.current?.blur?.();
        amountInputRef.current?.blur?.();
        Keyboard.dismiss();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!openRef.current) return;
        router.dismiss();
    }, [router]);

    const cycleUnit = useCallback(() => {
        const price = bitcoin?.price ?? 100000;
        const idx = UNITS.indexOf(inputUnit);
        const next = UNITS[(idx + 1) % UNITS.length];
        if (amount) {
            const sats = toSats(amount, inputUnit, price);
            setAmount(sats === 0n ? '' : toDisplay(sats, next, price));
        }
        setInputUnit(next);
    }, [amount, bitcoin?.price, inputUnit]);

    const validSats = useMemo(() => {
        if (!amount) return 0n;
        const price = bitcoin?.price ?? 100000;
        const max = mode === 'request' ? MAX_REQUEST_AMOUNT : balance != null ? BigInt(Math.floor(Number(balance))) : 0n;
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
        const requireWalletAndChat = (peer) => mode !== 'request' || (!!peer.walletPK && !!peer.chatPK);
        if (!search.trim()) return list.filter(requireWalletAndChat);
        if (!query) return [];
        return mergeProfiles({
            local: list,
            remote: results || [],
            parsed: query,
            extraFilter: requireWalletAndChat,
        });
    }, [mode, peers, query, results, search]);

    const handleOpenChat = useCallback(() => {
        if (chatBanned) return;
        if (!selectedPeer?.chatPK || !chatPK) return;
        if (!lockRoute()) return;
        const chatId = getChatId(chatPK, selectedPeer.chatPK);
        selectChat?.(chatId);
        router.replace({ pathname: '/currentchat', params: { id: chatId } });
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
                Alert.alert('Missing chat key', 'This person has no chat key yet.');
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
            Alert.alert('Missing address', 'This person has no wallet key yet.');
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

    const renderPeer = useCallback(
        ({ item }) => {
            const selected = samePeer(selectedPeer, item);
            return <PeerCell item={item} onSelect={handleSelectPeer} theme={theme} selected={selected} disabled={!item?.walletPK && !item?.chatPK} />;
        },
        [handleSelectPeer, selectedPeer, theme]
    );

    const peerKey = useCallback((item, index) => item?.uid || item?.chatPK || item?.walletPK || `${index}`, []);
    const cycleStyle = useAnimatedStyle(() => ({ transform: [{ scale: cycleScale.value }] }));
    const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
    const footerPad = useDerivedValue(() => {
        const footerInset = keyboardHeight.value > 0 ? 8 : insets.bottom;
        return overlayVisible ? FOOTER_CONTENT_HEIGHT + footerInset : 0;
    }, [overlayVisible, insets.bottom]);
    const renderScrollComponent = useCallback((props) => <PeerScroll {...props} pad={footerPad} />, [footerPad]);
    const cyclePress = tap({ value: cycleScale, disabled: isSending, onPress: cycleUnit });
    const modeIcon = mode === 'request' ? ArrowDownLeft : ArrowUpRight;
    const sendLabel =
        mode === 'request'
            ? isSending
                ? 'requesting...'
                : selectedPeer
                  ? `request from ${formatUserDisplay(selectedPeer, false)}`
                  : 'request'
            : isSending
              ? 'sending...'
              : selectedPeer
                ? `send to ${formatUserDisplay(selectedPeer, false)}`
                : 'send';
    const sendDisabled = !validSats || isSending || (mode === 'request' ? chatBanned || !selectedPeer?.chatPK : !selectedPeer?.walletPK);

    return (
        <View style={{ flex: 1, overflow: 'hidden', paddingHorizontal: 12 }} onLayout={handleSheetLayout}>
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
                    onFocus={handleSearchFocus}
                    onClear={handleClearSearch}
                    searching={searching}
                    glassEffectStyle="regular"
                    style={{
                        zIndex: 1,
                    }}
                />
            </View>
            <KeyboardGestureArea interpolator="ios" style={{ flex: 1, paddingTop: 20 }} textInputNativeID={INPUT_ID}>
                <FlatList
                    data={filteredPeers}
                    keyExtractor={peerKey}
                    renderItem={renderPeer}
                    renderScrollComponent={renderScrollComponent}
                    numColumns={3}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ flexGrow: 1, paddingTop: 18 + 24, paddingBottom: insets.bottom + 12 }}
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

                <KeyboardStickyView offset={{ opened: getKeyboardOffset(insets.bottom) }} style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom, zIndex: 2 }} pointerEvents="box-none">
                    <Animated.View pointerEvents={isSending ? 'none' : 'box-none'} style={[{ paddingHorizontal: 14, gap: 12 }, slideStyle]}>
                        <GlassField disabled={isSending} style={{ flex: 1, paddingHorizontal: 16 }}>
                            <TextInput
                                ref={amountInputRef}
                                nativeID={INPUT_ID}
                                value={amount}
                                placeholder={inputUnit === 'sats' ? '0000' : '0.00'}
                                placeholderTextColor={theme.muted}
                                keyboardType="numeric"
                                onChangeText={setAmount}
                                editable={!isSending}
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
                            <GlassIcon icon={MessageCircle} onPress={handleOpenChat} disabled={!selectedPeer?.chatPK || isSending || chatBanned} />
                        </View>
                    </Animated.View>
                </KeyboardStickyView>
            </KeyboardGestureArea>
        </View>
    );
}
