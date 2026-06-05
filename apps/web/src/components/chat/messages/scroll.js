import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { afterNextPaint } from '../rowmotion';

const MAX_CHAT_SCROLL_MEMORY = 50;
const BOTTOM_STICK_PX = 32;
const SCROLL_BOTTOM_PAGES = 2;
const chatScrollMemory = new Map();

function rememberChatScroll(chatId, scrollTop) {
    if (!chatId || !Number.isFinite(scrollTop)) {
        return;
    }

    chatScrollMemory.delete(chatId);
    chatScrollMemory.set(chatId, scrollTop);
    while (chatScrollMemory.size > MAX_CHAT_SCROLL_MEMORY) {
        const oldest = chatScrollMemory.keys().next().value;
        if (!oldest) {
            return;
        }
        chatScrollMemory.delete(oldest);
    }
}

function getReverseBottomDistance(node) {
    return node ? Math.max(0, -node.scrollTop) : 0;
}

function isAtReverseBottom(node) {
    return !!node && getReverseBottomDistance(node) <= BOTTOM_STICK_PX;
}

function isFarFromReverseBottom(node) {
    const page = node?.clientHeight || 0;
    return page > 0 && getReverseBottomDistance(node) > page * SCROLL_BOTTOM_PAGES;
}

function scrollToReverseBottom(node) {
    if (node) {
        node.scrollTop = 0;
    }
}

export function useScroll({ bottomPad, chatId, displayCount, hasOlder, loadingOlder, loadOlder, newestRowKey, ready }) {
    const [showOlderLoader, setShowOlderLoader] = useState(false);
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const scrollRef = useRef(null);
    const loadMoreRef = useRef(null);
    const loadingOlderRef = useRef(false);
    const chatIdRef = useRef(chatId);
    const restoredChatIdRef = useRef('');
    const restoreFrameRef = useRef(null);
    const stickToBottomRef = useRef(true);
    const bottomScrollFrameRef = useRef(null);

    const clearBottomScroll = useCallback(() => {
        if (bottomScrollFrameRef.current) {
            bottomScrollFrameRef.current();
            bottomScrollFrameRef.current = null;
        }
    }, []);

    const scrollBottomIfSticky = useCallback(() => {
        const node = scrollRef.current;
        if (!stickToBottomRef.current) {
            return;
        }
        scrollToReverseBottom(node);
        setShowScrollBottom(false);
    }, []);

    const scheduleBottomScroll = useCallback(() => {
        if (!stickToBottomRef.current) {
            return;
        }

        if (bottomScrollFrameRef.current) {
            bottomScrollFrameRef.current();
        }
        scrollBottomIfSticky();
        bottomScrollFrameRef.current = afterNextPaint(() => {
            bottomScrollFrameRef.current = null;
            scrollBottomIfSticky();
        });
    }, [scrollBottomIfSticky]);

    const handleListScroll = useCallback(
        (event) => {
            const node = event.currentTarget;
            rememberChatScroll(chatId, node.scrollTop);
            const sticky = isAtReverseBottom(node);
            stickToBottomRef.current = sticky;
            setShowScrollBottom(!sticky && isFarFromReverseBottom(node));
            if (!sticky) {
                setShowOlderLoader(true);
            }
        },
        [chatId]
    );

    const scrollToBottom = useCallback(() => {
        const node = scrollRef.current;
        scrollToReverseBottom(node);
        if (node) {
            rememberChatScroll(chatId, node.scrollTop);
        }
        stickToBottomRef.current = true;
        setShowScrollBottom(false);
    }, [chatId]);

    const handleListTransitionEnd = useCallback(
        (event) => {
            if (event.propertyName === 'height') {
                scheduleBottomScroll();
            }
        },
        [scheduleBottomScroll]
    );

    const handleLoadOlder = useCallback(async () => {
        if (!hasOlder || loadingOlder || loadingOlderRef.current) {
            return false;
        }

        loadingOlderRef.current = true;
        try {
            return await loadOlder();
        } finally {
            loadingOlderRef.current = false;
        }
    }, [hasOlder, loadOlder, loadingOlder]);

    useEffect(() => {
        chatIdRef.current = chatId;
        loadingOlderRef.current = false;
        setShowOlderLoader(false);
        setShowScrollBottom(false);
    }, [chatId]);

    useLayoutEffect(() => {
        const node = scrollRef.current;
        if (!node || !chatId || restoredChatIdRef.current === chatId) {
            return;
        }

        const nextScrollTop = chatScrollMemory.get(chatId) ?? 0;
        node.scrollTop = nextScrollTop;
        stickToBottomRef.current = isAtReverseBottom(node);
        setShowOlderLoader(!stickToBottomRef.current);
        setShowScrollBottom(!stickToBottomRef.current && isFarFromReverseBottom(node));
        restoredChatIdRef.current = chatId;

        if (restoreFrameRef.current) {
            cancelAnimationFrame(restoreFrameRef.current);
        }
        restoreFrameRef.current = requestAnimationFrame(() => {
            restoreFrameRef.current = null;
            if (scrollRef.current === node) {
                node.scrollTop = nextScrollTop;
                stickToBottomRef.current = isAtReverseBottom(node);
                setShowOlderLoader(!stickToBottomRef.current);
                setShowScrollBottom(!stickToBottomRef.current && isFarFromReverseBottom(node));
            }
        });

        return () => {
            if (restoreFrameRef.current) {
                cancelAnimationFrame(restoreFrameRef.current);
                restoreFrameRef.current = null;
            }
        };
    }, [chatId, displayCount, ready]);

    useEffect(
        () => () => {
            const node = scrollRef.current;
            const activeChatId = chatIdRef.current;
            if (node && activeChatId) {
                rememberChatScroll(activeChatId, node.scrollTop);
            }
            if (restoreFrameRef.current) {
                cancelAnimationFrame(restoreFrameRef.current);
                restoreFrameRef.current = null;
            }
            clearBottomScroll();
        },
        [clearBottomScroll]
    );

    useLayoutEffect(() => {
        if (!chatId || !ready) {
            return;
        }
        scheduleBottomScroll();
    }, [bottomPad, chatId, newestRowKey, ready, scheduleBottomScroll]);

    useEffect(() => {
        const root = scrollRef.current;
        const target = loadMoreRef.current;
        if (!target || !root || !hasOlder) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    void handleLoadOlder();
                }
            },
            {
                root,
                rootMargin: '200px 0px 0px 0px',
            }
        );

        observer.observe(target);
        return () => observer.disconnect();
    }, [chatId, handleLoadOlder, hasOlder]);

    return {
        handleListScroll,
        handleListTransitionEnd,
        loadMoreRef,
        scrollRef,
        scrollToBottom,
        showOlderLoader,
        showScrollBottom,
    };
}
