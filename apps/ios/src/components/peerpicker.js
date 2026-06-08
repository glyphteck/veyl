import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import Animated, { Easing, scrollTo, useAnimatedRef, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatUserDisplay, peerKey } from '@veyl/shared/profile';
import { truncateLabel } from '@veyl/shared/utils/display';

import Avatar from '@/components/avatar';
import SearchInput from '@/components/search';
import { KeyboardChatScrollView, KeyboardStickyView, useReanimatedKeyboardAnimation } from '@/components/keyboardscroll';
import { tap } from '@/lib/tap';

const FOOTER_OFFSCREEN = 260;
export const PEER_PICKER_FOOTER_HEIGHT = 122;
export const PEER_PICKER_BUTTON_FOOTER_HEIGHT = 54;
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

export function samePeer(a, b) {
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

export default function PeerPicker({
    emptyState,
    footer,
    footerInteractive,
    footerHeight = PEER_PICKER_FOOTER_HEIGHT,
    footerOpen,
    footerScrollPeer,
    footerStyle,
    isPeerDisabled,
    isPeerSelected,
    onClearSearch,
    onFooterHidden,
    onPeerPress,
    onSearchChange,
    peers,
    search,
    searching,
    searchInputRef,
    theme,
}) {
    const insets = useSafeAreaInsets();
    const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
    const listRef = useAnimatedRef();
    const listHeightRef = useRef(0);
    const listScrollYRef = useRef(0);
    const footerHeightRef = useRef(footerHeight);
    const peersRef = useRef([]);
    const footerOpenRef = useRef(false);
    const openFooterRef = useRef(footer);

    const footerLive = useSharedValue(0);
    const footerProgress = useSharedValue(0);
    const footerReserve = useSharedValue(footerHeight + FOOTER_LIST_CLEARANCE);
    const linkedScrollBase = useSharedValue(0);
    const linkedScrollDelta = useSharedValue(0);
    const linkedScrollActive = useSharedValue(0);

    peersRef.current = peers;
    if (footerOpen) {
        openFooterRef.current = footer;
    }

    useDerivedValue(() => {
        if (!linkedScrollActive.value) {
            return;
        }

        scrollTo(listRef, 0, Math.max(0, linkedScrollBase.value + linkedScrollDelta.value * footerProgress.value), false);
    });
    const footerExtraPadding = useDerivedValue(() => footerReserve.value * footerProgress.value);

    const getFooterHeight = useCallback(() => Math.max(0, footerHeightRef.current || footerHeight), [footerHeight]);
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

            const index = peersRef.current.findIndex((item) => samePeer(item, peer));
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
            const delta = getPeerFooterDelta(peer);
            if (delta <= 0) return;

            listRef.current?.scrollToOffset?.({
                offset: Math.max(0, listScrollYRef.current + delta),
                animated: true,
            });
        },
        [getPeerFooterDelta, listRef]
    );

    const finishCloseFooter = useCallback(() => {
        onFooterHidden?.();
    }, [onFooterHidden]);

    const closeFooter = useCallback(() => {
        const closeDuration = getFooterCloseDuration();
        linkedScrollActive.value = 0;
        footerProgress.value = withTiming(0, { duration: closeDuration, easing: FOOTER_CLOSE_EASING }, (done) => {
            if (done) {
                footerLive.value = 0;
                scheduleOnRN(finishCloseFooter);
            }
        });
    }, [finishCloseFooter, footerLive, footerProgress, getFooterCloseDuration, linkedScrollActive]);

    useEffect(() => {
        if (footerOpen) {
            const wasOpen = footerOpenRef.current;
            footerOpenRef.current = true;
            if (wasOpen) {
                scrollPeerAboveFooter(footerScrollPeer);
            } else {
                startLinkedFooterOpen(footerScrollPeer);
            }
            return;
        }

        if (footerOpenRef.current) {
            footerOpenRef.current = false;
            closeFooter();
        }
    }, [closeFooter, footerOpen, footerScrollPeer, scrollPeerAboveFooter, startLinkedFooterOpen]);

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
            if (footerOpen) {
                scrollPeerAboveFooter(footerScrollPeer);
            }
        },
        [footerOpen, footerReserve, footerScrollPeer, scrollPeerAboveFooter]
    );

    const renderPeer = useCallback(
        ({ item }) => (
            <PeerCell
                item={item}
                onSelect={onPeerPress}
                theme={theme}
                selected={isPeerSelected?.(item)}
                disabled={isPeerDisabled?.(item)}
            />
        ),
        [isPeerDisabled, isPeerSelected, onPeerPress, theme]
    );

    const keyExtractor = useCallback((item, index) => peerKey(item, `${index}`), []);
    const slideStyle = useAnimatedStyle(() => {
        if (!footerLive.value && footerProgress.value <= 0) {
            return { transform: [{ scale: FOOTER_PRELOAD_SCALE }] };
        }

        return { transform: [{ translateY: FOOTER_OFFSCREEN * (1 - footerProgress.value) }, { scale: 1 }] };
    });
    const stickyOffset = useMemo(() => ({ closed: 0, opened: insets.bottom - FOOTER_KEYBOARD_GAP }), [insets.bottom]);
    const footerBottom = insets.bottom;
    const listBottomPadding = insets.bottom + LIST_DEFAULT_BOTTOM_GAP;
    const visibleFooter = footerOpen ? footer : openFooterRef.current;
    const renderScrollComponent = useCallback(
        (props) => <KeyboardChatScrollView {...props} keyboardLiftBehavior="never" extraContentPadding={footerExtraPadding} />,
        [footerExtraPadding]
    );

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
                    onChangeText={onSearchChange}
                    onClear={onClearSearch}
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
                    data={peers}
                    keyExtractor={keyExtractor}
                    renderItem={renderPeer}
                    numColumns={3}
                    keyboardDismissMode="interactive"
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ flexGrow: 1, paddingTop: LIST_CONTENT_TOP, paddingBottom: listBottomPadding }}
                    renderScrollComponent={renderScrollComponent}
                    style={{ flex: 1 }}
                    onScroll={handleListScroll}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator={false}
                    bounces
                    alwaysBounceVertical
                    automaticallyAdjustContentInsets={false}
                    automaticallyAdjustsScrollIndicatorInsets={false}
                    contentInsetAdjustmentBehavior="never"
                    ListEmptyComponent={emptyState}
                />

                <KeyboardStickyView offset={stickyOffset} style={{ position: 'absolute', left: 0, right: 0, bottom: footerBottom, zIndex: 2 }} pointerEvents="box-none">
                    <Animated.View
                        onLayout={handleFooterLayout}
                        pointerEvents={footerInteractive ? 'box-none' : 'none'}
                        accessibilityElementsHidden={!footerInteractive}
                        importantForAccessibility={footerInteractive ? 'auto' : 'no-hide-descendants'}
                        style={[{ paddingHorizontal: 14, gap: 12 }, footerStyle, slideStyle]}
                    >
                        {visibleFooter}
                    </Animated.View>
                </KeyboardStickyView>
            </View>
        </View>
    );
}
