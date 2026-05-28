'use client';
import { ArrowDown, Loader } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/button';
import { useChat } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { canShareAttachmentMsg, canShowMsg, collapseSystemMessages, getLatestReadOutgoingReceipt, isPeerMsg, isReadReceiptMsg, isSystemMsg, setReqTx } from '@glyphteck/shared/chat/messages';
import { useOptimisticMessageReactions } from '@glyphteck/shared/chat/usereactions';
import { formatUserDisplay, formatFullDateTime } from '@/lib/utils';
import { getPeerChatPKFromChatId } from '@glyphteck/shared/chat/ids';
import { getMessageOrderMs } from '@glyphteck/shared/chat/state';
import { CHAT_RETENTION_SEEN, getMessageRetention, onSeenMessageTtlMs, seenMessageTtlMs } from '@glyphteck/shared/chat/ttl';
import { useChatMessages } from './usechatmessages';
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { canSaveMsgFile, saveMsgFile } from '@/lib/messages';
import { MemoMessageRow } from './messagerow';
import { MESSAGE_ROW_LEAVE_MS, afterNextPaint } from './rowmotion';

const LIKE_TAP_MS = 320;
const LIKE_TAP_DIST = 42;
const MAX_CHAT_SCROLL_MEMORY = 50;
const BOTTOM_STICK_PX = 32;
const SCROLL_BOTTOM_PAGES = 2;
const EMPTY_RECEIPT_PEER = Object.freeze({});
const EMPTY_MESSAGE_KEY_SET = new Set();
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

function getMsgKey(msg) {
    return msg?.cid || msg?.id;
}

function getMsgKeys(msg) {
    return [...new Set([getMsgKey(msg), msg?.id, msg?.cid].filter(Boolean))];
}

function rowHasKey(row, keys) {
    if (!keys?.size) {
        return false;
    }
    if (row?.key && keys.has(row.key)) {
        return true;
    }
    return getMsgKeys(row?.msg).some((key) => keys.has(key));
}

function isInteractiveTarget(target) {
    return !!target?.closest?.('button,a,input,textarea,select,video,audio,[role="button"]');
}

function hasOwnMessageTtl(msg) {
    return Object.prototype.hasOwnProperty.call(msg || {}, 'ttl');
}

function isSavedForeverMsg(msg) {
    return !!(msg?.id && !String(msg.id).startsWith('local:') && !msg.pending && !msg.failed && hasOwnMessageTtl(msg) && msg.ttl == null);
}

function canToggleSaveForeverMsg(msg) {
    return !!(msg?.id && !String(msg.id).startsWith('local:') && !msg.pending && !msg.failed && !isSystemMsg(msg));
}

function positiveMs(value) {
    const ms = Number(value);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function getSavedTtlMs(msg) {
    return positiveMs(msg?.savedTtl);
}

function messageOrderMs(message) {
    const ms = getMessageOrderMs(message);
    return Number.isFinite(ms) ? ms : null;
}

function readReceiptFromRecipient(receipt, msg, chatPK, peerChatPK) {
    const messageFromPeer = isPeerMsg(msg, chatPK);
    const receiptFromPeer = isPeerMsg(receipt, chatPK);
    return messageFromPeer ? !receiptFromPeer : receiptFromPeer && (!peerChatPK || receipt?.s === peerChatPK);
}

function readReceiptCoversMessage(receipt, msg, byKey, chatPK) {
    const targetKey = typeof receipt?.upto === 'string' ? receipt.upto.trim() : '';
    if (!targetKey) {
        return false;
    }
    if (targetKey === getMsgKey(msg)) {
        return true;
    }

    const target = byKey.get(targetKey);
    if (target && isPeerMsg(target, chatPK) !== isPeerMsg(msg, chatPK)) {
        return false;
    }

    const messageMs = messageOrderMs(msg);
    const targetMs = messageOrderMs(target) ?? messageOrderMs({ cid: targetKey }) ?? messageOrderMs(receipt);
    return messageMs != null && targetMs != null && messageMs <= targetMs;
}

function getMessageSeenAtMs(messages, msg, chatPK, peerChatPK, now = Date.now()) {
    const byKey = new Map();
    for (const item of messages || []) {
        const key = getMsgKey(item);
        if (key) {
            byKey.set(key, item);
        }
    }

    let seenAt = null;
    for (const receipt of messages || []) {
        if (!receipt?.id || String(receipt.id).startsWith('local:') || receipt.pending || receipt.failed || !isReadReceiptMsg(receipt) || !readReceiptFromRecipient(receipt, msg, chatPK, peerChatPK)) {
            continue;
        }
        if (!readReceiptCoversMessage(receipt, msg, byKey, chatPK)) {
            continue;
        }
        const receiptMs = messageOrderMs(receipt);
        if (receiptMs != null && (seenAt == null || receiptMs < seenAt)) {
            seenAt = receiptMs;
        }
    }

    if (seenAt == null && isPeerMsg(msg, chatPK) && canShowMsg(msg)) {
        return now;
    }
    return seenAt;
}

function getUnsaveTtlMs(msg, messages, chatPK, peerChatPK, now = Date.now()) {
    const seenAt = getMessageSeenAtMs(messages, msg, chatPK, peerChatPK, now);
    if (seenAt != null) {
        return getMessageRetention(msg) === CHAT_RETENTION_SEEN ? onSeenMessageTtlMs(seenAt) : seenMessageTtlMs(seenAt);
    }
    return getSavedTtlMs(msg);
}

function formatMsgFullDateTime(msg) {
    const ms = getMessageOrderMs(msg);
    return Number.isFinite(ms) && ms !== Infinity ? formatFullDateTime(ms) : '';
}

function sameRowList(left, right) {
    if (left === right) {
        return true;
    }
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
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

function makePresentRows(messages, hiddenKeys = EMPTY_MESSAGE_KEY_SET) {
    return messages
        .map((msg) => ({
            key: getMsgKey(msg),
            msg,
            state: 'present',
        }))
        .filter((row) => row.key && !rowHasKey(row, hiddenKeys));
}

function useAnimatedMessageRows(messages, scopeKey, hiddenKeys = EMPTY_MESSAGE_KEY_SET, animate = true) {
    const presentRows = useMemo(() => makePresentRows(messages, hiddenKeys), [hiddenKeys, messages]);
    const [state, setState] = useState(() => ({ scopeKey, rows: presentRows, animated: animate }));
    const reset = state.scopeKey !== scopeKey;

    useLayoutEffect(() => {
        setState((prev) => {
            if (prev.scopeKey !== scopeKey || !animate || !prev.animated) {
                return { scopeKey, rows: presentRows, animated: animate };
            }

            const nextKeys = new Set(presentRows.map((row) => row.key));
            const prevByKey = new Map();
            const prevIndexByKey = new Map();

            prev.rows.forEach((row, index) => {
                prevByKey.set(row.key, row);
                prevIndexByKey.set(row.key, index);
            });

            const firstRetainedIndex = presentRows.findIndex((row) => {
                const prevRow = prevByKey.get(row.key);
                return prevRow && prevRow.state !== 'leaving';
            });
            const newestInsertCount = prev.rows.length ? Math.max(0, firstRetainedIndex) : presentRows.length;

            const nextRows = presentRows.map((row, index) => {
                const prevRow = prevByKey.get(row.key);
                const retained = prevRow && prevRow.state !== 'leaving';
                const state = retained ? 'present' : index < newestInsertCount ? 'entering' : 'instant';
                if (prevRow && prevRow.state === state && prevRow.msg === row.msg) {
                    return prevRow;
                }
                return { ...row, state };
            });
            const olderInsertStart = nextRows.findIndex((row, index) => index >= newestInsertCount && row.state === 'instant');
            if (olderInsertStart > 0) {
                const boundary = nextRows[olderInsertStart - 1];
                if (boundary?.state === 'present') {
                    nextRows[olderInsertStart - 1] = { ...boundary, state: 'instant' };
                }
            }
            const result = [];
            let prevCursor = 0;

            const pushDroppedRowsBefore = (index) => {
                while (prevCursor < index) {
                    const row = prev.rows[prevCursor];
                    if (!nextKeys.has(row.key)) {
                        result.push(row.state === 'leaving' ? row : { ...row, state: 'leaving' });
                    }
                    prevCursor += 1;
                }
            };

            for (const row of nextRows) {
                const prevIndex = prevIndexByKey.get(row.key);
                if (prevIndex != null) {
                    pushDroppedRowsBefore(prevIndex);
                    prevCursor = Math.max(prevCursor, prevIndex + 1);
                }
                result.push(row);
            }

            pushDroppedRowsBefore(prev.rows.length);
            if (sameRowList(prev.rows, result)) {
                return prev;
            }
            return { scopeKey, rows: result, animated: true };
        });
    }, [animate, presentRows, scopeKey]);

    useEffect(() => {
        if (!state.animated || state.scopeKey !== scopeKey || !state.rows.some((row) => row.state === 'entering' || row.state === 'instant')) {
            return undefined;
        }

        return afterNextPaint(() => {
            setState((prev) => {
                if (prev.scopeKey !== scopeKey) {
                    return prev;
                }
                return {
                    ...prev,
                    rows: prev.rows.map((row) => (row.state === 'entering' || row.state === 'instant' ? { ...row, state: 'present' } : row)),
                };
            });
        });
    }, [scopeKey, state.animated, state.rows, state.scopeKey]);

    useEffect(() => {
        if (!state.animated || state.scopeKey !== scopeKey || !state.rows.some((row) => row.state === 'leaving')) {
            return undefined;
        }

        const timeout = setTimeout(() => {
            setState((prev) => {
                if (prev.scopeKey !== scopeKey) {
                    return prev;
                }
                return {
                    ...prev,
                    rows: prev.rows.filter((row) => row.state !== 'leaving'),
                };
            });
        }, MESSAGE_ROW_LEAVE_MS + 50);

        return () => clearTimeout(timeout);
    }, [scopeKey, state.animated, state.rows, state.scopeKey]);

    return reset ? presentRows : state.rows;
}

export function MessageList({ onReply, onEdit, bottomPad = 96 }) {
    const { selectedChatId, updateMessage, deleteMessage, retryMessage, makeMessagePermanent, makeMessageTemporary, readMessageFile, sendReaction } = useChat();
    const { avatar, chatPK } = useUser();
    const { peerByChatPK } = usePeer();
    const { sendMoneyWithSpark } = useWallet();
    const { openDialog } = useDialog();
    const [payingMessages, setPayingMessages] = useState(new Set());
    const [savingMessages, setSavingMessages] = useState(new Set());
    const [savingForeverMessages, setSavingForeverMessages] = useState(new Map());
    const [reportedMessageKeys, setReportedMessageKeys] = useState(new Set());
    const [deletingMessageKeys, setDeletingMessageKeys] = useState(EMPTY_MESSAGE_KEY_SET);
    const [showOlderLoader, setShowOlderLoader] = useState(false);
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const scrollRef = useRef(null);
    const loadMoreRef = useRef(null);
    const loadingOlderRef = useRef(false);
    const selectedChatIdRef = useRef(selectedChatId);
    const restoredChatIdRef = useRef('');
    const restoreFrameRef = useRef(null);
    const stickToBottomRef = useRef(true);
    const bottomScrollFrameRef = useRef(null);
    const deleteCleanupTimersRef = useRef(new Map());
    const rowRefs = useRef(new Map());
    const lastLikeTapRef = useRef(null);
    const receiptSnapshotRef = useRef(new Map());
    const receiptSnapshotChatRef = useRef('');
    if (receiptSnapshotChatRef.current !== (selectedChatId || '')) {
        receiptSnapshotChatRef.current = selectedChatId || '';
        receiptSnapshotRef.current.clear();
    }

    const { messages: msgs, ready, hasOlder, loadingOlder, loadOlder, patchMessage, removeMessage } = useChatMessages(selectedChatId);
    const visibleMsgs = useMemo(() => collapseSystemMessages((msgs || []).filter(canShowMsg)), [msgs]);
    const displayMsgs = useMemo(() => [...visibleMsgs].reverse(), [visibleMsgs]);
    const displayRows = useAnimatedMessageRows(displayMsgs, selectedChatId || '', deletingMessageKeys, ready);
    const newestRowKey = displayRows.find((row) => row.state !== 'leaving')?.key || '';
    const replyMap = useMemo(() => {
        const map = new Map();
        for (const msg of visibleMsgs || []) {
            if (msg?.id) {
                map.set(msg.id, msg);
            }
            if (msg?.cid) {
                map.set(msg.cid, msg);
            }
        }
        return map;
    }, [visibleMsgs]);

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
            rememberChatScroll(selectedChatId, node.scrollTop);
            const sticky = isAtReverseBottom(node);
            stickToBottomRef.current = sticky;
            setShowScrollBottom(!sticky && isFarFromReverseBottom(node));
            if (!sticky) {
                setShowOlderLoader(true);
            }
        },
        [selectedChatId]
    );

    const scrollToBottom = useCallback(() => {
        const node = scrollRef.current;
        scrollToReverseBottom(node);
        if (node) {
            rememberChatScroll(selectedChatId, node.scrollTop);
        }
        stickToBottomRef.current = true;
        setShowScrollBottom(false);
    }, [selectedChatId]);

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
        selectedChatIdRef.current = selectedChatId;
        loadingOlderRef.current = false;
        setShowOlderLoader(false);
        setShowScrollBottom(false);
    }, [selectedChatId]);

    useEffect(() => {
        setReportedMessageKeys(new Set());
        setDeletingMessageKeys(EMPTY_MESSAGE_KEY_SET);
        for (const timeout of deleteCleanupTimersRef.current.values()) {
            clearTimeout(timeout);
        }
        deleteCleanupTimersRef.current.clear();
    }, [selectedChatId]);

    useLayoutEffect(() => {
        const node = scrollRef.current;
        if (!node || !selectedChatId || restoredChatIdRef.current === selectedChatId) {
            return;
        }

        const nextScrollTop = chatScrollMemory.get(selectedChatId) ?? 0;
        node.scrollTop = nextScrollTop;
        stickToBottomRef.current = isAtReverseBottom(node);
        setShowOlderLoader(!stickToBottomRef.current);
        setShowScrollBottom(!stickToBottomRef.current && isFarFromReverseBottom(node));
        restoredChatIdRef.current = selectedChatId;

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
    }, [displayMsgs.length, ready, selectedChatId]);

    useEffect(
        () => () => {
            const node = scrollRef.current;
            const chatId = selectedChatIdRef.current;
            if (node && chatId) {
                rememberChatScroll(chatId, node.scrollTop);
            }
            if (restoreFrameRef.current) {
                cancelAnimationFrame(restoreFrameRef.current);
                restoreFrameRef.current = null;
            }
            clearBottomScroll();
            for (const timeout of deleteCleanupTimersRef.current.values()) {
                clearTimeout(timeout);
            }
            deleteCleanupTimersRef.current.clear();
        },
        [clearBottomScroll]
    );

    useLayoutEffect(() => {
        if (!selectedChatId || !ready) {
            return;
        }
        scheduleBottomScroll();
    }, [bottomPad, newestRowKey, ready, scheduleBottomScroll, selectedChatId]);

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
    }, [handleLoadOlder, hasOlder, selectedChatId]);

    const peerChatPK = useMemo(() => getPeerChatPKFromChatId(selectedChatId, chatPK), [chatPK, selectedChatId]);
    const peerProfile = useMemo(() => peerByChatPK.get(peerChatPK) ?? null, [peerByChatPK, peerChatPK]);
    const peerDisplayName = useMemo(
        () =>
            formatUserDisplay({
                username: peerProfile?.username,
                chatPK: peerChatPK,
            }),
        [peerChatPK, peerProfile?.username]
    );
    const reactionUsers = useMemo(
        () => ({
            ...(chatPK ? { [chatPK]: { avatar } } : {}),
            ...(peerChatPK ? { [peerChatPK]: { avatar: peerProfile?.avatar, bot: peerProfile?.bot } } : {}),
        }),
        [avatar, chatPK, peerChatPK, peerProfile?.avatar, peerProfile?.bot]
    );
    const { getReactions: getOptimisticReactions, toggleReaction: toggleOptimisticReaction } = useOptimisticMessageReactions({
        chatId: selectedChatId,
        chatPK,
        peerChatPK,
        messages: msgs,
        sendReaction,
        onError: (error) => console.error('message like failed', error),
    });
    const latestReadReceipt = useMemo(() => getLatestReadOutgoingReceipt(msgs, chatPK, peerChatPK), [chatPK, msgs, peerChatPK]);
    const latestReadReceiptKey = latestReadReceipt?.message?.cid || latestReadReceipt?.message?.id || null;
    const latestReadReceiptTime = useMemo(() => formatMsgFullDateTime(latestReadReceipt?.receipt), [latestReadReceipt?.receipt]);
    const latestReceiptMeta = useMemo(
        () =>
            latestReadReceiptKey
                ? {
                      peer: peerProfile || EMPTY_RECEIPT_PEER,
                      time: latestReadReceiptTime,
                  }
                : null,
        [latestReadReceiptKey, latestReadReceiptTime, peerProfile]
    );
    const leavingReceiptKey = useMemo(
        () =>
            displayRows.find((row) => {
                if (row?.state !== 'leaving' || !row?.key) {
                    return false;
                }
                return receiptSnapshotRef.current.has(row.key) || row.key === latestReadReceiptKey;
            })?.key || '',
        [displayRows, latestReadReceiptKey]
    );
    const suppressLiveReceipt = !!leavingReceiptKey && leavingReceiptKey !== latestReadReceiptKey;

    useEffect(() => {
        if (!latestReadReceiptKey || !latestReceiptMeta) {
            return;
        }
        receiptSnapshotRef.current.set(latestReadReceiptKey, latestReceiptMeta);
    }, [latestReadReceiptKey, latestReceiptMeta]);

    useEffect(() => {
        setSavingForeverMessages((prev) => {
            if (!prev.size) {
                return prev;
            }

            const byKey = new Map();
            for (const message of msgs || []) {
                for (const key of getMsgKeys(message)) {
                    byKey.set(key, message);
                }
            }

            let changed = false;
            const next = new Map(prev);
            for (const [key, targetSaved] of prev) {
                const message = byKey.get(key);
                if (!message || isSavedForeverMsg(message) === targetSaved) {
                    next.delete(key);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [msgs]);

    const canLikeMessage = useCallback(
        (msg) => {
            return !!(selectedChatId && chatPK && peerChatPK && msg?.id && !String(msg.id).startsWith('local:') && !msg.pending && !msg.failed);
        },
        [chatPK, peerChatPK, selectedChatId]
    );

    const canSaveMessage = useCallback((msg) => canSaveMsgFile(msg, peerChatPK), [peerChatPK]);

    const canToggleSaveForeverMessage = useCallback(
        (msg) => {
            return !!selectedChatId && canToggleSaveForeverMsg(msg);
        },
        [selectedChatId]
    );

    const saveMessage = useCallback(
        async (msg) => {
            if (!canSaveMessage(msg)) {
                return;
            }

            const key = getMsgKey(msg);
            if (key) {
                setSavingMessages((prev) => new Set(prev).add(key));
            }

            try {
                await saveMsgFile(readMessageFile, peerChatPK, msg);
            } catch (error) {
                console.warn('chat media save failed', error);
                toast('save failed', {
                    description: error?.message || 'Could not save this message.',
                });
            } finally {
                if (key) {
                    setSavingMessages((prev) => {
                        const next = new Set(prev);
                        next.delete(key);
                        return next;
                    });
                }
            }
        },
        [canSaveMessage, peerChatPK, readMessageFile]
    );

    const toggleSaveForeverMessage = useCallback(
        async (msg) => {
            if (!canToggleSaveForeverMessage(msg)) {
                return;
            }

            const key = getMsgKey(msg);
            const saved = isSavedForeverMsg(msg);
            const targetSaved = !saved;
            const unsaveTtlMs = saved ? getUnsaveTtlMs(msg, msgs, chatPK, peerChatPK) : null;

            if (key) {
                setSavingForeverMessages((prev) => new Map(prev).set(key, targetSaved));
            }

            try {
                if (saved) {
                    await makeMessageTemporary(selectedChatId, msg, peerChatPK, { ttlMs: unsaveTtlMs });
                } else {
                    await makeMessagePermanent(selectedChatId, msg, peerChatPK);
                }
            } catch (error) {
                console.warn('message save forever update failed', error);
                toast(saved ? 'unsave failed' : 'save failed', {
                    description: error?.message || 'Could not update this message.',
                });
                if (key) {
                    setSavingForeverMessages((prev) => {
                        const next = new Map(prev);
                        next.delete(key);
                        return next;
                    });
                }
            }
        },
        [canToggleSaveForeverMessage, chatPK, makeMessagePermanent, makeMessageTemporary, msgs, peerChatPK, selectedChatId]
    );

    const toggleLikeMessage = useCallback(
        (msg) => {
            if (!canLikeMessage(msg)) {
                return;
            }

            toggleOptimisticReaction(msg);
        },
        [canLikeMessage, toggleOptimisticReaction]
    );

    const handleMessagePointerUp = useCallback(
        (event, msg) => {
            if (!canLikeMessage(msg) || isInteractiveTarget(event.target) || (event.pointerType === 'mouse' && event.button !== 0)) {
                return;
            }

            const key = getMsgKey(msg);
            if (!key) {
                return;
            }

            const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
            const x = Number(event.clientX) || 0;
            const y = Number(event.clientY) || 0;
            const last = lastLikeTapRef.current;
            const isDoubleTap = last?.key === key && now - last.time <= LIKE_TAP_MS && Math.hypot(x - last.x, y - last.y) <= LIKE_TAP_DIST;

            lastLikeTapRef.current = { key, time: now, x, y };

            if (!isDoubleTap) {
                return;
            }

            event.preventDefault();
            lastLikeTapRef.current = null;
            void toggleLikeMessage(msg);
        },
        [canLikeMessage, toggleLikeMessage]
    );

    const handlePayment = useCallback(
        async (msg) => {
            if (!peerProfile?.walletPK) return;
            setPayingMessages((p) => new Set(p).add(msg.id));
            try {
                const txId = await sendMoneyWithSpark(peerProfile.walletPK, String(msg.a));
                const newMessage = { ...setReqTx(msg, txId), cid: msg.cid };
                patchMessage(msg.id, newMessage);
                try {
                    await updateMessage(selectedChatId, msg.id, newMessage, peerChatPK);
                } catch (error) {
                    console.error('Payment sent but failed to sync request confirmation:', error);
                }
            } catch (error) {
                console.error('Failed to send payment:', error);
            } finally {
                setPayingMessages((p) => {
                    const s = new Set(p);
                    s.delete(msg.id);
                    return s;
                });
            }
        },
        [patchMessage, peerChatPK, peerProfile?.walletPK, selectedChatId, sendMoneyWithSpark, updateMessage]
    );

    const markReported = useCallback((msg) => {
        const key = getMsgKey(msg);
        if (!key) {
            return;
        }
        setReportedMessageKeys((prev) => {
            const next = new Set(prev);
            next.add(key);
            return next;
        });
    }, []);

    const clearDeletingMessage = useCallback((msg) => {
        const keys = getMsgKeys(msg);
        if (!keys.length) {
            return;
        }

        for (const key of keys) {
            const timeout = deleteCleanupTimersRef.current.get(key);
            if (timeout) {
                clearTimeout(timeout);
                deleteCleanupTimersRef.current.delete(key);
            }
        }

        setDeletingMessageKeys((prev) => {
            if (!keys.some((key) => prev.has(key))) {
                return prev;
            }
            const next = new Set(prev);
            for (const key of keys) {
                next.delete(key);
            }
            return next.size ? next : EMPTY_MESSAGE_KEY_SET;
        });
    }, []);

    const startDeletingMessage = useCallback((msg) => {
        const keys = getMsgKeys(msg);
        if (!keys.length) {
            return;
        }

        setDeletingMessageKeys((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const key of keys) {
                if (!next.has(key)) {
                    changed = true;
                    next.add(key);
                }
            }
            return changed ? next : prev;
        });
    }, []);

    const finishDeletingMessage = useCallback(
        (id, msg) => {
            const keys = getMsgKeys(msg);
            const timeout = setTimeout(() => {
                removeMessage(id);
                clearDeletingMessage(msg);
            }, MESSAGE_ROW_LEAVE_MS + 80);

            for (const key of keys) {
                const previous = deleteCleanupTimersRef.current.get(key);
                if (previous) {
                    clearTimeout(previous);
                }
                deleteCleanupTimersRef.current.set(key, timeout);
            }
        },
        [clearDeletingMessage, removeMessage]
    );

    const deleteSelectedMessage = useCallback(
        async (msg) => {
            if (!selectedChatId || !msg?.id || String(msg.id).startsWith('local:')) {
                return;
            }

            startDeletingMessage(msg);

            try {
                await deleteMessage(selectedChatId, msg.id);
                finishDeletingMessage(msg.id, msg);
            } catch (error) {
                clearDeletingMessage(msg);
                console.error('delete message failed', error);
                toast('delete failed', {
                    description: error?.message || 'Could not delete this message.',
                });
            }
        },
        [clearDeletingMessage, deleteMessage, finishDeletingMessage, selectedChatId, startDeletingMessage]
    );

    const openShareDialog = useCallback(
        (msg) => {
            if (!canShareAttachmentMsg(msg)) {
                return;
            }
            openDialog('sharemedia', { msg });
        },
        [openDialog]
    );

    const retrySentMessage = useCallback((msg) => retryMessage(selectedChatId, msg.cid), [retryMessage, selectedChatId]);

    const reportMessage = useCallback(
        (msg) =>
            openDialog('report', {
                peer: peerProfile,
                msg,
                peerChatPK,
                onReported: () => markReported(msg),
            }),
        [markReported, openDialog, peerChatPK, peerProfile]
    );

    const jumpToReply = useCallback((replyId) => {
        const key = String(replyId ?? '').trim();
        if (!key) {
            return;
        }
        rowRefs.current.get(key)?.scrollIntoView?.({
            behavior: 'smooth',
            block: 'center',
        });
    }, []);

    if (!ready) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader className="animate-spin size-7" />
            </div>
        );
    }

    return (
        <div className="relative h-full min-h-0">
            <div
                ref={scrollRef}
                className="flex h-full min-h-0 flex-col-reverse overflow-y-auto px-4 pt-17"
                style={{ paddingBottom: Math.max(68, bottomPad + 32) }}
                onScroll={handleListScroll}
                onTransitionEnd={handleListTransitionEnd}
            >
                {displayRows.map(({ key, msg, state: rowState }, index) => {
                    const fromPeer = isPeerMsg(msg, chatPK);
                    const userSent = !fromPeer;
                    const msgKey = getMsgKey(msg);
                    const isReported = !!msgKey && reportedMessageKeys.has(msgKey);
                    const saving = !!msgKey && savingMessages.has(msgKey);
                    const savingForever = !!msgKey && savingForeverMessages.has(msgKey);
                    const saveForeverTargetSaved = savingForever ? savingForeverMessages.get(msgKey) === true : null;
                    const savedForever = isSavedForeverMsg(msg);
                    const reply = msg?.r ? replyMap.get(msg.r) || null : null;
                    const replyFromPeer = reply ? isPeerMsg(reply, chatPK) : false;
                    const currentReceipt = !suppressLiveReceipt && userSent && msgKey && msgKey === latestReadReceiptKey ? latestReceiptMeta : null;
                    const frozenReceipt = rowState === 'leaving' && msgKey ? receiptSnapshotRef.current.get(msgKey) || (msgKey === latestReadReceiptKey ? latestReceiptMeta : null) : null;
                    const receipt = frozenReceipt || currentReceipt;
                    return (
                        <MemoMessageRow
                            key={key}
                            msg={msg}
                            rowState={rowState}
                            hasRowAbove={index < displayRows.length - 1}
                            fromPeer={fromPeer}
                            userSent={userSent}
                            peerChatPK={peerChatPK}
                            peerDisplayName={peerDisplayName}
                            peerProfile={peerProfile}
                            reactionUsers={reactionUsers}
                            reply={reply}
                            replyFromPeer={replyFromPeer}
                            receiptPeer={receipt?.peer || null}
                            receiptTime={receipt?.time || ''}
                            isReported={isReported}
                            isSaving={saving}
                            isSavedForever={savedForever}
                            saveForeverTargetSaved={saveForeverTargetSaved}
                            isSavingForever={savingForever}
                            isPaying={payingMessages.has(msg.id)}
                            canSaveForever={canToggleSaveForeverMsg(msg)}
                            rowRefs={rowRefs}
                            getOptimisticReactions={getOptimisticReactions}
                            onReply={onReply}
                            onEdit={onEdit}
                            onRetry={retrySentMessage}
                            onDownload={saveMessage}
                            onSaveForever={toggleSaveForeverMessage}
                            onShare={openShareDialog}
                            onDelete={deleteSelectedMessage}
                            onReport={reportMessage}
                            onPay={handlePayment}
                            onPointerUp={handleMessagePointerUp}
                            onJumpToReply={jumpToReply}
                        />
                    );
                })}
                {loadingOlder && showOlderLoader ? (
                    <div className="flex items-center justify-center py-2">
                        <Loader className="animate-spin size-5" />
                    </div>
                ) : null}
                <div ref={loadMoreRef} />
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 mb-6 flex justify-end px-6">
                <div className="pop pointer-events-auto" data-open={showScrollBottom}>
                    <Button type="button" title="scroll to bottom" aria-label="scroll to bottom" className="grower-lg size-10 rounded-full bg-background/85 p-0 text-foreground shadow backdrop-blur-sm" onClick={scrollToBottom}>
                        <ArrowDown className="size-6" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
