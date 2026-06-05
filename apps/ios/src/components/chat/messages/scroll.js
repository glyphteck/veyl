import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from '@/components/keyboardscroll';
import { positivePx } from '@/components/chat/rowmotion';

const NEWEST_GAP = 8;
const BOTTOM_SHOW_MIN_DISTANCE = 360;
const BOTTOM_SHOW_PAGE_FRACTION = 1.25;
const BOTTOM_HIDE_PAGE_FRACTION = 1;
const BOTTOM_ANIMATION_MS = 160;
const BOTTOM_START_SCALE = 0.001;
const BOTTOM_DIRECTION_EPSILON = 2;
const KEYBOARD_GAP = 8;

export function useScroll({ chatId, extraContentPadding, hasOlder, inputH, loadOlder, loadingOlder }) {
    const insets = useSafeAreaInsets();
    const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
    const [showBottom, setShowBottom] = useState(false);
    const [bottomMounted, setBottomMounted] = useState(false);
    const listRef = useRef(null);
    const loadingOlderRef = useRef(false);
    const bottomDistanceRef = useRef(0);
    const bottomProgress = useSharedValue(0);
    const stickyOffset = useMemo(() => ({ closed: 0, opened: insets.bottom - KEYBOARD_GAP }), [insets.bottom]);
    const bottomBase = positivePx(insets.bottom + inputH + 20);
    const contentContainerStyle = useMemo(
        () => ({
            paddingTop: positivePx(insets.bottom + inputH + NEWEST_GAP),
            paddingBottom: insets.top + 42 + 24,
        }),
        [insets.bottom, insets.top, inputH]
    );
    const composerReserveStyle = useAnimatedStyle(() => {
        const extra = extraContentPadding ? extraContentPadding.value : 0;
        const keyboard = Math.max(0, Math.round(-keyboardHeight.value - insets.bottom));
        return { height: keyboard + Math.max(0, Math.round(extra)) };
    }, [extraContentPadding, insets.bottom, keyboardHeight]);
    const bottomStyle = useAnimatedStyle(() => ({
        transform: [
            {
                scale: BOTTOM_START_SCALE + (1 - BOTTOM_START_SCALE) * bottomProgress.value,
            },
        ],
    }));
    const bottomPositionStyle = useAnimatedStyle(() => {
        const extra = extraContentPadding ? extraContentPadding.value : 0;
        return { bottom: Math.max(0, Math.round(bottomBase + extra)) };
    }, [extraContentPadding, bottomBase]);

    useEffect(() => {
        let timer;

        if (showBottom) {
            setBottomMounted(true);
            bottomProgress.value = withTiming(1, {
                duration: BOTTOM_ANIMATION_MS,
                easing: Easing.out(Easing.cubic),
            });
            return undefined;
        }

        bottomProgress.value = withTiming(0, {
            duration: BOTTOM_ANIMATION_MS,
            easing: Easing.in(Easing.cubic),
        });
        timer = setTimeout(() => setBottomMounted(false), BOTTOM_ANIMATION_MS);
        return () => clearTimeout(timer);
    }, [bottomProgress, showBottom]);

    useEffect(() => {
        loadingOlderRef.current = false;
        bottomDistanceRef.current = 0;
        setShowBottom(false);
    }, [chatId]);

    const handleLoadOlder = useCallback(async () => {
        if (!hasOlder || loadingOlder || loadingOlderRef.current) {
            return;
        }

        loadingOlderRef.current = true;
        try {
            await loadOlder();
        } finally {
            loadingOlderRef.current = false;
        }
    }, [hasOlder, loadOlder, loadingOlder]);

    const handleListScroll = useCallback((event) => {
        const y = Number(event?.nativeEvent?.contentOffset?.y) || 0;
        const page = Number(event?.nativeEvent?.layoutMeasurement?.height) || 0;
        const distance = Math.max(0, y);
        const previousDistance = bottomDistanceRef.current;
        const movingAwayFromBottom = distance > previousDistance + BOTTOM_DIRECTION_EPSILON;
        const showDistance = Math.max(BOTTOM_SHOW_MIN_DISTANCE, page * BOTTOM_SHOW_PAGE_FRACTION);
        const hideDistance = page * BOTTOM_HIDE_PAGE_FRACTION;
        bottomDistanceRef.current = distance;
        setShowBottom((show) => distance > hideDistance && (show || (movingAwayFromBottom && distance > showDistance)));
    }, []);

    const scrollToBottom = useCallback(() => {
        listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
        setShowBottom(false);
    }, []);

    return {
        bottomMounted,
        bottomPositionStyle,
        bottomStyle,
        composerReserveStyle,
        contentContainerStyle,
        handleListScroll,
        handleLoadOlder,
        listRef,
        scrollToBottom,
        showBottom,
        stickyOffset,
    };
}
