'use client';
import { Download, Flag, Loader, Reply, RotateCcw, Share2, SquarePen, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useChat } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { Avatar, AvatarFallback, StaticAvatar } from '@/components/avatar';
import { canReplyToMsg, canShareAttachmentMsg, canShowMsg, getLatestReadOutgoingReceipt, isPeerMsg, setReqTx } from '@glyphteck/shared/chat/messages';
import { useOptimisticMessageReactions } from '@glyphteck/shared/chat/usereactions';
import { formatUserDisplay, formatFullDateTime } from '@/lib/utils';
import { getPeerChatPKFromChatId } from '@glyphteck/shared/chat/utils';
import { getMessageOrderMs } from '@glyphteck/shared/chat/state';
import { useChatMessages } from './usechatmessages';
import { forwardRef, useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { ChatMessageType } from './messages';
import { bubbleBg, canSaveMsgFile, saveMsgFile } from '@/lib/messages';

const LIKE_TAP_MS = 320;
const LIKE_TAP_DIST = 42;
const MESSAGE_ROW_ANIMATION_MS = 160;
const MESSAGE_ROW_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const MAX_CHAT_SCROLL_MEMORY = 50;
const MESSAGE_ACTION_ICON = 'size-4';
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

function isInteractiveTarget(target) {
    return !!target?.closest?.('button,a,input,textarea,select,video,audio,[role="button"]');
}

function formatMsgFullDateTime(msg) {
    const ms = getMessageOrderMs(msg);
    return Number.isFinite(ms) && ms !== Infinity ? formatFullDateTime(ms) : '';
}

function afterNextPaint(callback) {
    let secondFrame = null;
    const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(callback);
    });

    return () => {
        cancelAnimationFrame(firstFrame);
        if (secondFrame) {
            cancelAnimationFrame(secondFrame);
        }
    };
}

function SendDot({ show, failed }) {
    return (
        <div aria-hidden="true" className={`pointer-events-none ml-2 flex h-2 w-2 shrink-0 items-center justify-center transition-opacity ease-out ${show ? 'opacity-100' : 'opacity-0'}`}>
            <div className={`size-2 rounded-full shadow-sm ${failed ? 'bg-destructive' : 'bg-active'}`} />
        </div>
    );
}

function ActionButton({ title, icon: Icon, className = 'text-muted', iconClassName = '', onClick, disabled = false }) {
    return (
        <button
            type="button"
            title={title}
            className={`grower-lg flex size-4 items-center justify-center rounded-full px-0 py-0 disabled:cursor-default disabled:opacity-50 disabled:hover:scale-100 ${className}`}
            disabled={disabled}
            onClick={(event) => {
                event.stopPropagation();
                if (disabled) {
                    return;
                }
                onClick?.();
            }}
        >
            <Icon className={`${MESSAGE_ACTION_ICON} ${iconClassName}`.trim()} />
        </button>
    );
}

function MessageActions({ actions, fromPeer }) {
    if (!actions.length) {
        return null;
    }

    return (
        <div className={`absolute top-1/2 z-20 -translate-y-1/2 ${fromPeer ? 'left-full ml-2' : 'right-full mr-2'}`}>
            <div className="pop group-pop flex items-center gap-2">
                {actions.map(({ key, ...action }) => (
                    <ActionButton key={key} {...action} />
                ))}
            </div>
        </div>
    );
}

function makeMessageActions({
    msg,
    userSent,
    canReply,
    canEdit,
    canRetry,
    canSave,
    canShare,
    canDelete,
    canReport,
    saving,
    onReply,
    onEdit,
    onRetry,
    onSave,
    onShare,
    onDelete,
    onReport,
}) {
    return [
        canReply && typeof onReply === 'function'
            ? {
                  key: 'reply',
                  title: 'reply',
                  icon: Reply,
                  onClick: () => onReply(msg),
              }
            : null,
        userSent && canEdit && typeof onEdit === 'function'
            ? {
                  key: 'edit',
                  title: 'edit',
                  icon: SquarePen,
                  onClick: () => onEdit(msg),
              }
            : null,
        userSent && canRetry
            ? {
                  key: 'retry',
                  title: 'retry',
                  icon: RotateCcw,
                  onClick: onRetry,
              }
            : null,
        canSave
            ? {
                  key: 'save',
                  title: 'save',
                  icon: saving ? Loader : Download,
                  iconClassName: saving ? 'animate-spin' : '',
                  onClick: onSave,
                  disabled: saving,
              }
            : null,
        canShare
            ? {
                  key: 'share',
                  title: 'share',
                  icon: Share2,
                  onClick: onShare,
              }
            : null,
        canDelete
            ? {
                  key: 'delete',
                  title: 'delete',
                  icon: Trash2,
                  className: 'text-destructive',
                  onClick: onDelete,
              }
            : null,
        !userSent && canReport
            ? {
                  key: 'report',
                  title: 'report',
                  icon: Flag,
                  onClick: onReport,
              }
            : null,
    ].filter(Boolean);
}

function MessageMeta({ time, receiptTime, receiptPeer, userSent }) {
    const showReceipt = userSent && !!receiptPeer;
    const [receiptHovered, setReceiptHovered] = useState(false);
    const label = showReceipt && receiptHovered && receiptTime ? `seen at ${receiptTime}` : time;

    return (
        <div className={`mt-1 flex h-4 items-center ${userSent ? 'justify-end' : 'justify-start'}`}>
            <div className="relative flex items-center">
                <p
                    className="text-xs leading-4 font-black text-muted opacity-0 transition-[opacity,transform] ease-out group-hover:opacity-100"
                    style={{
                        transform: userSent && showReceipt ? 'translateX(-24px)' : 'translateX(0)',
                    }}
                >
                    {label}
                </p>
                {userSent ? (
                    <div
                        aria-hidden={!showReceipt}
                        title={showReceipt && receiptTime ? `seen at ${receiptTime}` : undefined}
                        className="absolute inset-y-0 right-0 flex h-4 items-center justify-center transition-[opacity,transform] ease-out"
                        style={{
                            opacity: showReceipt ? 1 : 0,
                            pointerEvents: showReceipt ? 'auto' : 'none',
                            transform: `translateX(${showReceipt ? '0' : '6px'}) scale(${showReceipt ? 1 : 0.6})`,
                        }}
                        onMouseEnter={() => setReceiptHovered(true)}
                        onMouseLeave={() => setReceiptHovered(false)}
                        onFocus={() => setReceiptHovered(true)}
                        onBlur={() => setReceiptHovered(false)}
                    >
                        {receiptPeer?.avatar ? (
                            <span className="block size-4 overflow-hidden rounded-full bg-background">
                                <StaticAvatar src={receiptPeer.avatar} aria-hidden="true" />
                            </span>
                        ) : (
                            <Avatar bot={!!receiptPeer?.bot} className="size-4 shadow-none">
                                <AvatarFallback />
                            </Avatar>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function ReportedMessage({ fromPeer }) {
    return (
        <div className={`backdrop-blur-sm min-w-0 max-w-full shadow-sm rounded-round px-3 py-1.5 ${bubbleBg(fromPeer)}`}>
            <p className="min-w-0 wrap-break-word whitespace-pre-wrap text-muted">reported message hidden</p>
        </div>
    );
}

function makePresentRows(messages) {
    return messages
        .map((msg) => ({
            key: getMsgKey(msg),
            msg,
            state: 'present',
        }))
        .filter((row) => row.key);
}

function useAnimatedMessageRows(messages, scopeKey) {
    const presentRows = useMemo(() => makePresentRows(messages), [messages]);
    const [state, setState] = useState(() => ({ scopeKey, rows: presentRows }));
    const reset = state.scopeKey !== scopeKey;

    useLayoutEffect(() => {
        setState((prev) => {
            if (prev.scopeKey !== scopeKey) {
                return { scopeKey, rows: presentRows };
            }

            const nextKeys = new Set(presentRows.map((row) => row.key));
            const prevByKey = new Map();
            const prevIndexByKey = new Map();

            prev.rows.forEach((row, index) => {
                prevByKey.set(row.key, row);
                prevIndexByKey.set(row.key, index);
            });

            const nextRows = presentRows.map((row) => {
                const prevRow = prevByKey.get(row.key);
                return {
                    ...row,
                    state: prevRow && prevRow.state !== 'leaving' ? 'present' : 'entering',
                };
            });
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
            return { scopeKey, rows: result };
        });
    }, [presentRows, scopeKey]);

    useEffect(() => {
        if (state.scopeKey !== scopeKey || !state.rows.some((row) => row.state === 'entering')) {
            return undefined;
        }

        return afterNextPaint(() => {
            setState((prev) => {
                if (prev.scopeKey !== scopeKey) {
                    return prev;
                }
                return {
                    ...prev,
                    rows: prev.rows.map((row) => (row.state === 'entering' ? { ...row, state: 'present' } : row)),
                };
            });
        });
    }, [scopeKey, state.rows, state.scopeKey]);

    useEffect(() => {
        if (state.scopeKey !== scopeKey || !state.rows.some((row) => row.state === 'leaving')) {
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
        }, MESSAGE_ROW_ANIMATION_MS + 50);

        return () => clearTimeout(timeout);
    }, [scopeKey, state.rows, state.scopeKey]);

    return reset ? presentRows : state.rows;
}

const MessageRowShell = forwardRef(function MessageRowShell({ rowState = 'present', className, children }, ref) {
    const innerRef = useRef(null);
    const [height, setHeight] = useState(null);
    const heightRef = useRef(null);
    const entering = rowState === 'entering';
    const leaving = rowState === 'leaving';

    const setMeasuredHeight = useCallback((nextHeight) => {
        const next = Math.max(0, Math.ceil(nextHeight));
        heightRef.current = next;
        setHeight(next);
    }, []);

    useLayoutEffect(() => {
        const node = innerRef.current;
        if (!node) {
            return undefined;
        }

        const measure = () => Math.ceil(node.getBoundingClientRect().height);

        if (leaving) {
            setMeasuredHeight(heightRef.current ?? measure());
            return afterNextPaint(() => setMeasuredHeight(0));
        }

        if (entering) {
            setMeasuredHeight(0);
            return afterNextPaint(() => setMeasuredHeight(measure()));
        }

        setMeasuredHeight(measure());

        if (typeof ResizeObserver === 'undefined') {
            return undefined;
        }

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            const blockSize = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect?.height;
            if (Number.isFinite(blockSize)) {
                setMeasuredHeight(blockSize);
            }
        });
        observer.observe(node);

        return () => {
            observer.disconnect();
        };
    }, [entering, leaving, setMeasuredHeight]);

    return (
        <div
            ref={ref}
            className={className}
            style={{
                height: height == null ? undefined : height,
                overflow: entering || leaving ? 'hidden' : 'visible',
                transition: `height ${MESSAGE_ROW_ANIMATION_MS}ms ${MESSAGE_ROW_EASE}`,
                willChange: entering || leaving ? 'height' : undefined,
            }}
        >
            <div
                ref={innerRef}
                style={{
                    width: '100%',
                    opacity: entering || leaving ? 0 : 1,
                    transform: entering || leaving ? 'scale(0.98)' : 'scale(1)',
                    transformOrigin: 'center',
                    transition: `opacity ${MESSAGE_ROW_ANIMATION_MS}ms ease-out, transform ${MESSAGE_ROW_ANIMATION_MS}ms ${MESSAGE_ROW_EASE}`,
                    willChange: entering || leaving ? 'opacity, transform' : undefined,
                }}
            >
                {children}
            </div>
        </div>
    );
});

export function MessageList({ onReply, onEdit, bottomPad = 96 }) {
    const { selectedChatId, updateMessage, retryMessage, readMessageFile } = useChat();
    const { avatar, chatPK } = useUser();
    const { peers } = usePeer();
    const { sendMoneyWithSpark } = useWallet();
    const { openDialog } = useDialog();
    const [payingMessages, setPayingMessages] = useState(new Set());
    const [savingMessages, setSavingMessages] = useState(new Set());
    const [reportedMessageKeys, setReportedMessageKeys] = useState(new Set());
    const scrollRef = useRef(null);
    const loadMoreRef = useRef(null);
    const loadingOlderRef = useRef(false);
    const selectedChatIdRef = useRef(selectedChatId);
    const restoredChatIdRef = useRef('');
    const restoreFrameRef = useRef(null);
    const rowRefs = useRef(new Map());
    const lastLikeTapRef = useRef(null);

    const { messages: msgs, ready, hasOlder, loadingOlder, loadOlder, patchMessage, removeMessage } = useChatMessages(selectedChatId);
    const visibleMsgs = useMemo(() => (msgs || []).filter(canShowMsg), [msgs]);
    const displayMsgs = useMemo(() => [...visibleMsgs].reverse(), [visibleMsgs]);
    const displayRows = useAnimatedMessageRows(displayMsgs, selectedChatId || '');
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
    }, [selectedChatId]);

    useEffect(() => {
        setReportedMessageKeys(new Set());
    }, [selectedChatId]);

    useLayoutEffect(() => {
        const node = scrollRef.current;
        if (!node || !selectedChatId || restoredChatIdRef.current === selectedChatId) {
            return;
        }

        const nextScrollTop = chatScrollMemory.get(selectedChatId) ?? 0;
        node.scrollTop = nextScrollTop;
        restoredChatIdRef.current = selectedChatId;

        if (restoreFrameRef.current) {
            cancelAnimationFrame(restoreFrameRef.current);
        }
        restoreFrameRef.current = requestAnimationFrame(() => {
            restoreFrameRef.current = null;
            if (scrollRef.current === node) {
                node.scrollTop = nextScrollTop;
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
        },
        []
    );

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

    // Get peer info for display
    const peerChatPK = getPeerChatPKFromChatId(selectedChatId, chatPK);
    const peerProfile = peers?.find((peer) => peer.chatPK === peerChatPK) ?? null;
    const peerDisplayName = formatUserDisplay({
        username: peerProfile?.username,
        walletPK: peerChatPK,
    });
    const reactionUsers = useMemo(
        () => ({
            ...(chatPK ? { [chatPK]: { avatar } } : {}),
            ...(peerChatPK ? { [peerChatPK]: { avatar: peerProfile?.avatar, bot: peerProfile?.bot } } : {}),
        }),
        [avatar, chatPK, peerChatPK, peerProfile?.avatar, peerProfile?.bot]
    );
    const {
        getReactions: getOptimisticReactions,
        toggleReaction: toggleOptimisticReaction,
    } = useOptimisticMessageReactions({
        chatId: selectedChatId,
        chatPK,
        peerChatPK,
        messages: msgs,
        updateMessage,
        onError: (error) => console.error('message like failed', error),
    });
    const latestReadReceipt = useMemo(() => getLatestReadOutgoingReceipt(msgs, chatPK, peerChatPK), [chatPK, msgs, peerChatPK]);
    const latestReadReceiptKey = latestReadReceipt?.message?.cid || latestReadReceipt?.message?.id || null;
    const latestReadReceiptTime = useMemo(() => formatMsgFullDateTime(latestReadReceipt?.receipt), [latestReadReceipt?.receipt]);

    const canLikeMessage = useCallback(
        (msg) => {
            return !!(selectedChatId && chatPK && peerChatPK && msg?.id && !String(msg.id).startsWith('local:') && !msg.pending && !msg.failed);
        },
        [chatPK, peerChatPK, selectedChatId]
    );

    const canSaveMessage = useCallback((msg) => canSaveMsgFile(msg, peerChatPK), [peerChatPK]);

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

    const handlePayment = async (msg) => {
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
    };

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

    const openDeleteDialog = useCallback(
        (msg) => {
            if (!selectedChatId || !msg?.id || String(msg.id).startsWith('local:')) {
                return;
            }

            openDialog('deletemessage', {
                chatId: selectedChatId,
                msg,
                onDeleted: removeMessage,
            });
        },
        [openDialog, removeMessage, selectedChatId]
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

    if (!ready && msgs.length === 0) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader className="animate-spin size-7" />
            </div>
        );
    }

    return (
        <div
            ref={scrollRef}
            className="flex h-full min-h-0 flex-col-reverse gap-4 overflow-y-auto px-4 pt-17"
            style={{ paddingBottom: Math.max(68, bottomPad + 32) }}
            onScroll={(event) => rememberChatScroll(selectedChatId, event.currentTarget.scrollTop)}
        >
            {displayRows.map(({ key, msg, state: rowState }) => {
                const fromPeer = isPeerMsg(msg, chatPK);
                const userSent = !fromPeer;
                const showDot = userSent && (msg.pending || msg.failed);
                const msgKey = getMsgKey(msg);
                const isReported = !!msgKey && reportedMessageKeys.has(msgKey);
                const canReport = fromPeer && !!peerProfile?.uid && msg?.t !== 'req';
                const canRetry = userSent && msg.failed && !!msg.cid;
                const canDelete = !!msg?.id && !String(msg.id).startsWith('local:');
                const canEdit = userSent && msg?.t === 'txt';
                const canReply = canReplyToMsg(msg);
                const canSave = canSaveMessage(msg);
                const canShare = canShareAttachmentMsg(msg);
                const saving = !!msgKey && savingMessages.has(msgKey);
                const reply = msg?.r ? replyMap.get(msg.r) || null : null;
                const replyFromPeer = reply ? isPeerMsg(reply, chatPK) : false;
                const reactions = isReported ? [] : getOptimisticReactions(msg);
                const receiptPeer = userSent && msgKey && msgKey === latestReadReceiptKey ? peerProfile || {} : null;
                const actions = makeMessageActions({
                    msg,
                    userSent,
                    canReply,
                    canEdit,
                    canRetry,
                    canSave,
                    canShare,
                    canDelete,
                    canReport,
                    saving,
                    onReply,
                    onEdit,
                    onRetry: () => retryMessage(selectedChatId, msg.cid),
                    onSave: () => saveMessage(msg),
                    onShare: () => openShareDialog(msg),
                    onDelete: () => openDeleteDialog(msg),
                    onReport: () =>
                        openDialog('report', {
                            peer: peerProfile,
                            msg,
                            peerChatPK,
                            onReported: () => markReported(msg),
                        }),
                });
                return (
                    <MessageRowShell
                        key={key}
                        rowState={rowState}
                        ref={(node) => {
                            if (msg.id) {
                                if (node) rowRefs.current.set(msg.id, node);
                                else rowRefs.current.delete(msg.id);
                            }
                            if (msg.cid) {
                                if (node) rowRefs.current.set(msg.cid, node);
                                else rowRefs.current.delete(msg.cid);
                            }
                        }}
                        className={`group flex w-full flex-col ${userSent ? 'items-end' : 'items-start'}`}
                    >
                        <div className={`flex w-full items-center gap-2 flex-row ${userSent ? 'justify-end' : 'justify-start'}`}>
                            <div
                                className="relative max-w-[60%] flex min-w-0 items-center ease-out"
                                style={{
                                    transitionProperty: 'margin-right',
                                    marginRight: userSent ? (showDot ? 0 : -16) : 0,
                                }}
                            >
                                {isReported ? (
                                    <>
                                        <MessageActions actions={actions} fromPeer={fromPeer} />
                                        <ReportedMessage fromPeer={fromPeer} />
                                    </>
                                ) : (
                                    <div className="relative min-w-0 max-w-full touch-manipulation" onPointerUp={(event) => handleMessagePointerUp(event, msg)}>
                                        <ChatMessageType
                                            msg={msg}
                                            fromPeer={fromPeer}
                                            peerChatPK={peerChatPK}
                                            peerDisplayName={peerDisplayName}
                                            onPay={() => handlePayment(msg)}
                                            isPaying={payingMessages.has(msg.id)}
                                            reply={reply}
                                            replyFromPeer={replyFromPeer}
                                            onReplyPress={() => jumpToReply(msg.r)}
                                            reactions={reactions}
                                            reactionUsers={reactionUsers}
                                            actionSlot={<MessageActions actions={actions} fromPeer={fromPeer} />}
                                        />
                                    </div>
                                )}
                                {userSent ? <SendDot show={showDot} failed={msg.failed} /> : null}
                            </div>
                        </div>
                        <MessageMeta
                            time={formatFullDateTime(msg.ts?.toDate() || new Date())}
                            receiptTime={msgKey === latestReadReceiptKey ? latestReadReceiptTime : ''}
                            receiptPeer={receiptPeer}
                            userSent={userSent}
                        />
                    </MessageRowShell>
                );
            })}
            {loadingOlder ? (
                <div className="flex items-center justify-center py-2">
                    <Loader className="animate-spin size-5" />
                </div>
            ) : null}
            <div ref={loadMoreRef} />
        </div>
    );
}
