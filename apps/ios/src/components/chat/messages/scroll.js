import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { FLOATING_HEADER_SCROLL_EDGE_PAD, getFloatingHeaderScrollEdgeInset } from '@/components/floatingheader';
import { positivePx } from '@/components/chat/rowmotion';
import { useStableSafeAreaInsets } from '@/lib/safearea';

const NEWEST_GAP = 8;
const BOTTOM_SHOW_MIN_DISTANCE = 320;
const BOTTOM_SHOW_PAGE_MULTIPLIER = 2;
const BOTTOM_SHOW_ROW_COUNT = 30;
const BOTTOM_HIDE_DISTANCE = 72;
const BOTTOM_ANIMATION_MS = 160;
const BOTTOM_START_SCALE = 0.001;
const BOTTOM_SCROLL_SUPPRESS_MS = 1400;
const OLDER_LOAD_EDGE_DISTANCE = 140;
const OLDER_LOAD_REARM_DISTANCE = 420;
const OLDER_LOAD_SETTLE_SUPPRESS_MS = 700;
const RESTORE_OLDER_LOAD_SUPPRESS_MS = 500;
const SCROLL_STATE_LIMIT = 40;
const KEYBOARD_GAP = 8;

const scrollStateByChat = new Map();

function rememberChatScroll(chatId, offset) {
    const key = String(chatId || '').trim();
    if (!key) {
        return;
    }

    scrollStateByChat.delete(key);
    scrollStateByChat.set(key, Math.max(0, Math.round(Number(offset) || 0)));
    while (scrollStateByChat.size > SCROLL_STATE_LIMIT) {
        const oldest = scrollStateByChat.keys().next().value;
        if (!oldest) {
            return;
        }
        scrollStateByChat.delete(oldest);
    }
}

function readChatScroll(chatId) {
    const key = String(chatId || '').trim();
    if (!key || !scrollStateByChat.has(key)) {
        return 0;
    }
    const offset = scrollStateByChat.get(key) || 0;
    scrollStateByChat.delete(key);
    scrollStateByChat.set(key, offset);
    return offset;
}

function bottomShowThreshold(page, contentHeight, rowCount) {
    const thresholds = [];
    const pageHeight = positivePx(page);
    if (pageHeight > 0) {
        thresholds.push(pageHeight * BOTTOM_SHOW_PAGE_MULTIPLIER);
    }

    const rows = Math.max(0, Math.round(Number(rowCount) || 0));
    const height = positivePx(contentHeight);
    if (rows > 0 && height > 0) {
        thresholds.push((height / rows) * BOTTOM_SHOW_ROW_COUNT);
    }

    return Math.max(BOTTOM_SHOW_MIN_DISTANCE, thresholds.length ? Math.min(...thresholds) : BOTTOM_SHOW_MIN_DISTANCE);
}

function olderEdgeDistance(contentHeight, page, distanceFromNewest) {
    const maxOffset = Math.max(0, positivePx(contentHeight) - positivePx(page));
    return Math.max(0, maxOffset - Math.max(0, Number(distanceFromNewest) || 0));
}

export function useScroll({ chatId, extraContentPadding, hasOlder, headerHeight = 0, inputH, loadOlder, loadingOlder, rowCount = 0 }) {
    const insets = useStableSafeAreaInsets();
    const [showBottom, setShowBottom] = useState(false);
    const [bottomMounted, setBottomMounted] = useState(false);
    const listRef = useRef(null);
    const loadingOlderRef = useRef(false);
    const olderEdgeArmedRef = useRef(true);
    const bottomDistanceRef = useRef(0);
    const contentHeightRef = useRef(0);
    const pageHeightRef = useRef(0);
    const rowCountRef = useRef(rowCount);
    const scrollingToBottomRef = useRef(false);
    const scrollingToBottomTimerRef = useRef(null);
    const restoreOffsetRef = useRef(0);
    const restoreFrameRef = useRef(null);
    const suppressOlderLoadUntilRef = useRef(0);
    const bottomProgress = useSharedValue(0);
    const stickyOffset = useMemo(() => ({ closed: 0, opened: insets.bottom - KEYBOARD_GAP }), [insets.bottom]);
    const bottomBase = positivePx(insets.bottom + inputH + 20);
    const measuredHeaderHeight = positivePx(headerHeight);
    const headerEdgeInset = measuredHeaderHeight || getFloatingHeaderScrollEdgeInset(insets.top);
    const headerIndicatorInset = useMemo(() => ({ bottom: headerEdgeInset }), [headerEdgeInset]);
    const contentContainerStyle = useMemo(
        () => ({
            paddingTop: positivePx(insets.bottom + inputH + NEWEST_GAP),
            paddingBottom: positivePx(headerEdgeInset + FLOATING_HEADER_SCROLL_EDGE_PAD),
        }),
        [headerEdgeInset, insets.bottom, inputH]
    );
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

    const clearScrollingToBottomTimer = useCallback(() => {
        if (scrollingToBottomTimerRef.current) {
            clearTimeout(scrollingToBottomTimerRef.current);
            scrollingToBottomTimerRef.current = null;
        }
    }, []);

    const clearRestoreFrame = useCallback(() => {
        if (restoreFrameRef.current) {
            cancelAnimationFrame(restoreFrameRef.current);
            restoreFrameRef.current = null;
        }
    }, []);

    useEffect(() => {
        rowCountRef.current = rowCount;
    }, [rowCount]);

    const showBottomForDistance = useCallback((distance, page = pageHeightRef.current) => {
        const value = Math.max(0, Number(distance) || 0);
        if (value <= BOTTOM_HIDE_DISTANCE) {
            return false;
        }
        return value >= bottomShowThreshold(page, contentHeightRef.current, rowCountRef.current);
    }, []);

    const restoreSavedOffset = useCallback(
        (height = contentHeightRef.current, page = pageHeightRef.current) => {
            const restoreOffset = restoreOffsetRef.current;
            const nextHeight = positivePx(height);
            const pageHeight = positivePx(page);
            if (restoreOffset <= 1 || nextHeight <= 0 || pageHeight <= 0) {
                return false;
            }

            const maxOffset = Math.max(0, nextHeight - pageHeight);
            if (maxOffset + 2 < restoreOffset) {
                return false;
            }

            restoreOffsetRef.current = 0;
            bottomDistanceRef.current = restoreOffset;
            suppressOlderLoadUntilRef.current = Date.now() + RESTORE_OLDER_LOAD_SUPPRESS_MS;
            clearRestoreFrame();
            restoreFrameRef.current = requestAnimationFrame(() => {
                restoreFrameRef.current = null;
                listRef.current?.scrollToOffset?.({ offset: restoreOffset, animated: false });
                setShowBottom(showBottomForDistance(restoreOffset, pageHeight));
            });
            return true;
        },
        [clearRestoreFrame, showBottomForDistance]
    );

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
        const restoreOffset = readChatScroll(chatId);
        loadingOlderRef.current = false;
        contentHeightRef.current = 0;
        bottomDistanceRef.current = 0;
        pageHeightRef.current = 0;
        olderEdgeArmedRef.current = true;
        suppressOlderLoadUntilRef.current = 0;
        scrollingToBottomRef.current = false;
        restoreOffsetRef.current = restoreOffset;
        clearScrollingToBottomTimer();
        clearRestoreFrame();
        setShowBottom(false);
    }, [chatId, clearRestoreFrame, clearScrollingToBottomTimer]);

    useEffect(
        () => () => {
            rememberChatScroll(chatId, bottomDistanceRef.current);
        },
        [chatId]
    );

    useEffect(
        () => () => {
            clearScrollingToBottomTimer();
            clearRestoreFrame();
        },
        [clearRestoreFrame, clearScrollingToBottomTimer]
    );

    const handleLoadOlder = useCallback(async () => {
        if (!hasOlder || loadingOlder || loadingOlderRef.current) {
            return;
        }

        loadingOlderRef.current = true;
        try {
            const loaded = await loadOlder();
            if (loaded) {
                olderEdgeArmedRef.current = false;
                suppressOlderLoadUntilRef.current = Date.now() + OLDER_LOAD_SETTLE_SUPPRESS_MS;
            }
        } finally {
            loadingOlderRef.current = false;
        }
    }, [hasOlder, loadOlder, loadingOlder]);

    const maybeLoadOlder = useCallback(
        (distance, page) => {
            if (!hasOlder || loadingOlder || loadingOlderRef.current) {
                return;
            }
            if (Date.now() < suppressOlderLoadUntilRef.current) {
                return;
            }

            const contentHeight = contentHeightRef.current;
            if (contentHeight <= positivePx(page) + OLDER_LOAD_EDGE_DISTANCE) {
                return;
            }

            const distanceFromOlder = olderEdgeDistance(contentHeight, page, distance);
            if (distanceFromOlder > OLDER_LOAD_REARM_DISTANCE) {
                olderEdgeArmedRef.current = true;
                return;
            }

            if (!olderEdgeArmedRef.current || distanceFromOlder > OLDER_LOAD_EDGE_DISTANCE) {
                return;
            }

            olderEdgeArmedRef.current = false;
            void handleLoadOlder();
        },
        [handleLoadOlder, hasOlder, loadingOlder]
    );

    const handleContentSizeChange = useCallback(
        (_width, height) => {
            const nextHeight = positivePx(height);
            contentHeightRef.current = nextHeight;
            restoreSavedOffset(nextHeight);
        },
        [restoreSavedOffset]
    );

    const handleListLayout = useCallback(
        (event) => {
            const page = positivePx(event?.nativeEvent?.layout?.height);
            if (page <= 0) {
                return;
            }
            pageHeightRef.current = page;
            restoreSavedOffset(contentHeightRef.current, page);
        },
        [restoreSavedOffset]
    );

    const handleListScroll = useCallback(
        (event) => {
            const y = Number(event?.nativeEvent?.contentOffset?.y) || 0;
            const page = Number(event?.nativeEvent?.layoutMeasurement?.height) || 0;
            const distance = Math.max(0, y);
            pageHeightRef.current = page;
            bottomDistanceRef.current = distance;
            if (scrollingToBottomRef.current) {
                if (distance <= BOTTOM_HIDE_DISTANCE) {
                    clearScrollingToBottomTimer();
                    scrollingToBottomRef.current = false;
                }
                setShowBottom(false);
                return;
            }

            maybeLoadOlder(distance, page);
            if (distance <= BOTTOM_HIDE_DISTANCE) {
                setShowBottom(false);
                return;
            }
            setShowBottom(showBottomForDistance(distance, page));
        },
        [clearScrollingToBottomTimer, maybeLoadOlder, showBottomForDistance]
    );

    const handleListScrollEnd = useCallback(
        (event) => {
            const y = Number(event?.nativeEvent?.contentOffset?.y) || 0;
            const page = Number(event?.nativeEvent?.layoutMeasurement?.height) || pageHeightRef.current;
            const distance = Math.max(0, y);
            pageHeightRef.current = page;
            bottomDistanceRef.current = distance;
            if (scrollingToBottomRef.current && distance <= BOTTOM_HIDE_DISTANCE) {
                clearScrollingToBottomTimer();
                scrollingToBottomRef.current = false;
                setShowBottom(false);
                return;
            }
            if (scrollingToBottomRef.current) {
                return;
            }
            setShowBottom(showBottomForDistance(distance, page));
        },
        [clearScrollingToBottomTimer, showBottomForDistance]
    );

    const scrollToBottom = useCallback(() => {
        clearScrollingToBottomTimer();
        scrollingToBottomRef.current = true;
        listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
        bottomDistanceRef.current = 0;
        setShowBottom(false);
        scrollingToBottomTimerRef.current = setTimeout(() => {
            scrollingToBottomTimerRef.current = null;
            scrollingToBottomRef.current = false;
            setShowBottom(showBottomForDistance(bottomDistanceRef.current));
        }, BOTTOM_SCROLL_SUPPRESS_MS);
    }, [clearScrollingToBottomTimer, showBottomForDistance]);

    return {
        bottomMounted,
        bottomPositionStyle,
        bottomStyle,
        contentContainerStyle,
        handleContentSizeChange,
        handleListLayout,
        handleListScroll,
        handleListScrollEnd,
        listRef,
        scrollIndicatorInsets: headerIndicatorInset,
        scrollToBottom,
        showBottom,
        stickyOffset,
    };
}
