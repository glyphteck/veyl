'use client';
import { ArrowDown, Bookmark, Download, Flag, Loader, Reply, RotateCcw, Share2, SquarePen, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/button';
import { useChat } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { Avatar, AvatarFallback, StaticAvatar } from '@/components/avatar';
import { canReplyToMsg, canShareAttachmentMsg, canShowMsg, collapseSystemMessages, getLatestReadOutgoingReceipt, getSystemMsgText, isPeerMsg, isReadReceiptMsg, isSystemMsg, setReqTx } from '@glyphteck/shared/chat/messages';
import { useOptimisticMessageReactions } from '@glyphteck/shared/chat/usereactions';
import { formatUserDisplay, formatFullDateTime } from '@/lib/utils';
import { getPeerChatPKFromChatId } from '@glyphteck/shared/chat/utils';
import { getMessageOrderMs } from '@glyphteck/shared/chat/state';
import { CHAT_RETENTION_SEEN, getMessageRetention, onSeenMessageTtlMs, seenMessageTtlMs } from '@glyphteck/shared/chat/ttl';
import { useChatMessages } from './usechatmessages';
import { forwardRef, memo, useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { ChatMessageType } from './messages';
import { bubbleBg, canSaveMsgFile, saveMsgFile } from '@/lib/messages';

const LIKE_TAP_MS = 320;
const LIKE_TAP_DIST = 42;
const MESSAGE_ROW_ANIMATION_MS = 160;
const MESSAGE_ROW_EXIT_ANIMATION_MS = 160;
const MESSAGE_ROW_LEAVE_MS = MESSAGE_ROW_EXIT_ANIMATION_MS + MESSAGE_ROW_ANIMATION_MS;
const MESSAGE_ROW_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const MESSAGE_ROW_EXIT_EASE = 'linear';
const MESSAGE_ROW_EXIT_CLEARANCE_PX = 1;
const MESSAGE_ROW_EXIT_SCALE = 0;
const MESSAGE_ROW_GAP_PX = 8;
const MAX_CHAT_SCROLL_MEMORY = 50;
const MESSAGE_ACTION_ICON = 'size-4';
const BOTTOM_STICK_PX = 32;
const SCROLL_BOTTOM_PAGES = 2;
const EMPTY_RECEIPT_PEER = Object.freeze({});
const EMPTY_MESSAGE_ACTIONS = Object.freeze([]);
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

function MsgDot({ show, failed, saved = false, side = 'right' }) {
    const [visualSaved, setVisualSaved] = useState(saved);

    useEffect(() => {
        if (show || saved) {
            setVisualSaved(saved);
            return undefined;
        }

        const timeout = setTimeout(() => setVisualSaved(false), MESSAGE_ROW_ANIMATION_MS);
        return () => clearTimeout(timeout);
    }, [saved, show]);

    const colorClassName = failed ? 'bg-destructive' : visualSaved ? 'bg-foreground' : 'bg-active';
    return (
        <div
            aria-hidden="true"
            className="pointer-events-none flex h-2 shrink-0 items-center justify-center overflow-hidden ease-out"
            style={{
                marginLeft: side === 'right' && show ? 8 : 0,
                marginRight: side === 'left' && show ? 8 : 0,
                opacity: show ? 1 : 0,
                transform: `scale(${show ? 1 : 0.65})`,
                transitionDuration: `${MESSAGE_ROW_ANIMATION_MS}ms`,
                transitionProperty: 'opacity, width, margin, transform',
                width: show ? 8 : 0,
            }}
        >
            <div className={`size-2 rounded-full shadow-sm ${colorClassName}`} />
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
    canSaveForever,
    savedForever,
    savingForever,
    canDownload,
    canShare,
    canDelete,
    canReport,
    downloading,
    onReply,
    onEdit,
    onRetry,
    onSaveForever,
    onDownload,
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
        canSaveForever && typeof onSaveForever === 'function'
            ? {
                  key: 'save-forever',
                  title: savedForever ? 'unsave' : 'save forever',
                  icon: savingForever ? Loader : Bookmark,
                  iconClassName: savingForever ? 'animate-spin' : '',
                  onClick: onSaveForever,
                  disabled: savingForever,
              }
            : null,
        canDownload
            ? {
                  key: 'download',
                  title: 'download',
                  icon: downloading ? Loader : Download,
                  iconClassName: downloading ? 'animate-spin' : '',
                  onClick: onDownload,
                  disabled: downloading,
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

const MessageRowShell = forwardRef(function MessageRowShell({ rowState = 'present', hasRowAbove = false, gapPx = MESSAGE_ROW_GAP_PX, className, children }, ref) {
    const innerRef = useRef(null);
    const [height, setHeight] = useState(null);
    const [collapsing, setCollapsing] = useState(false);
    const heightRef = useRef(null);
    const entering = rowState === 'entering';
    const leaving = rowState === 'leaving';
    const instant = rowState === 'instant';
    const rowGap = hasRowAbove ? gapPx : 0;
    const enterTransform = `scale(0.98)`;
    const restingScaleTransform = 'scale(1)';

    const setMeasuredHeight = useCallback((nextHeight) => {
        const next = Math.max(0, Math.ceil(nextHeight));
        if (heightRef.current === next) {
            return;
        }
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
            setCollapsing(false);
            setMeasuredHeight(measure());
            const collapseTimeout = setTimeout(() => setCollapsing(true), MESSAGE_ROW_EXIT_ANIMATION_MS);
            return () => clearTimeout(collapseTimeout);
        }

        setCollapsing(false);

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
    }, [entering, leaving, rowGap, setMeasuredHeight]);

    return (
        <div
            ref={ref}
            className={className}
            style={{
                height: height == null ? undefined : collapsing ? 0 : height,
                overflow: entering ? 'hidden' : 'visible',
                position: leaving ? 'relative' : undefined,
                transition: instant ? 'none' : `height ${MESSAGE_ROW_ANIMATION_MS}ms ${MESSAGE_ROW_EASE}`,
                willChange: entering || leaving ? 'height' : undefined,
                pointerEvents: leaving ? 'none' : undefined,
            }}
        >
            <div
                ref={innerRef}
                style={{
                    width: '100%',
                    paddingTop: rowGap,
                    position: leaving ? 'absolute' : undefined,
                    top: leaving ? 0 : undefined,
                    left: leaving ? 0 : undefined,
                    right: leaving ? 0 : undefined,
                    opacity: entering ? 0 : 1,
                    transform: entering ? enterTransform : restingScaleTransform,
                    transition: instant ? 'none' : `opacity ${MESSAGE_ROW_ANIMATION_MS}ms ease-out, transform ${MESSAGE_ROW_ANIMATION_MS}ms ${MESSAGE_ROW_EASE}`,
                    willChange: entering ? 'opacity, transform' : undefined,
                }}
            >
                {children}
            </div>
        </div>
    );
});

function SystemMessageRow({ msg, rowState, hasRowAbove }) {
    return (
        <MessageRowShell rowState={rowState} hasRowAbove={hasRowAbove} gapPx={4} className="flex w-full shrink-0 items-center">
            <div className="mx-auto max-w-[76%] px-2 py-0.5 text-center text-xs font-black leading-4 text-muted">{getSystemMsgText(msg)}</div>
        </MessageRowShell>
    );
}

function MessageRow(props) {
    return isSystemMsg(props.msg) ? <SystemMessageRow msg={props.msg} rowState={props.rowState} hasRowAbove={props.hasRowAbove} /> : <InteractiveMessageRow {...props} />;
}

function InteractiveMessageRow({
    msg,
    rowState,
    hasRowAbove,
    fromPeer,
    userSent,
    peerChatPK,
    peerDisplayName,
    peerProfile,
    reactionUsers,
    reply,
    replyFromPeer,
    receiptPeer,
    receiptTime,
    isReported,
    isSaving,
    isSavedForever,
    saveForeverTargetSaved,
    isSavingForever,
    isPaying,
    rowRefs,
    getOptimisticReactions,
    onReply,
    onEdit,
    onRetry,
    onDownload,
    onSaveForever,
    onShare,
    onDelete,
    onReport,
    onPay,
    onPointerUp,
    onJumpToReply,
}) {
    const actionSavedForever = isSavingForever && typeof saveForeverTargetSaved === 'boolean' ? saveForeverTargetSaved : isSavedForever;
    const dotSavedForever = isSavedForever || saveForeverTargetSaved === true;
    const showMsgDot = (userSent && (msg.pending || msg.failed)) || dotSavedForever;
    const leaving = rowState === 'leaving';
    const rowNodeRef = useRef(null);
    const exitTargetRef = useRef(null);
    const [exitTranslate, setExitTranslate] = useState(0);
    const [visualExiting, setVisualExiting] = useState(false);
    const canReport = fromPeer && !!peerProfile?.uid && msg?.t !== 'req';
    const actions = useMemo(
        () =>
            makeMessageActions({
                msg,
                userSent,
                canReply: canReplyToMsg(msg),
                canEdit: userSent && msg?.t === 'txt',
                canRetry: userSent && msg.failed && !!msg.cid,
                canSaveForever: canToggleSaveForeverMsg(msg) && !isReported,
                savedForever: actionSavedForever,
                savingForever: isSavingForever,
                canDownload: canSaveMsgFile(msg, peerChatPK),
                canShare: canShareAttachmentMsg(msg),
                canDelete: !!msg?.id && !String(msg.id).startsWith('local:'),
                canReport,
                downloading: isSaving,
                onReply,
                onEdit,
                onRetry: () => onRetry(msg),
                onSaveForever: () => onSaveForever(msg),
                onDownload: () => onDownload(msg),
                onShare: () => onShare(msg),
                onDelete: () => onDelete(msg),
                onReport: () => onReport(msg),
            }),
        [actionSavedForever, canReport, isReported, isSaving, isSavingForever, msg, onDelete, onDownload, onEdit, onReply, onReport, onRetry, onSaveForever, onShare, peerChatPK, userSent]
    );
    const reactions = useMemo(() => (isReported ? [] : getOptimisticReactions(msg)), [getOptimisticReactions, isReported, msg]);
    const messageTime = useMemo(() => formatFullDateTime(msg.ts?.toDate() || new Date()), [msg.ts]);
    const setRowRef = useCallback(
        (node) => {
            rowNodeRef.current = node;
            if (msg.id) {
                if (node) rowRefs.current.set(msg.id, node);
                else rowRefs.current.delete(msg.id);
            }
            if (msg.cid) {
                if (node) rowRefs.current.set(msg.cid, node);
                else rowRefs.current.delete(msg.cid);
            }
        },
        [msg.cid, msg.id, rowRefs]
    );
    const handlePointerUp = useCallback((event) => onPointerUp(event, msg), [msg, onPointerUp]);
    const handlePay = useCallback(() => onPay(msg), [msg, onPay]);
    const handleReplyPress = useCallback(() => onJumpToReply(msg.r), [msg.r, onJumpToReply]);
    const visibleActions = leaving ? EMPTY_MESSAGE_ACTIONS : actions;
    const exitOuterTransform = visualExiting ? `translate3d(${exitTranslate}px, 0, 0)` : 'translate3d(0, 0, 0)';
    const exitInnerTransform = visualExiting ? `scale(${MESSAGE_ROW_EXIT_SCALE})` : 'scale(1)';

    useLayoutEffect(() => {
        if (!leaving) {
            setVisualExiting(false);
            setExitTranslate(0);
            return undefined;
        }

        const rowNode = rowNodeRef.current;
        const targetNode = exitTargetRef.current;
        if (!rowNode || !targetNode) {
            return undefined;
        }

        const rowRect = rowNode.getBoundingClientRect();
        const targetRect = targetNode.getBoundingClientRect();
        const rowCenter = rowRect.left + rowRect.width / 2;
        const targetCenter = targetRect.left + targetRect.width / 2;
        const exitsRight = targetCenter >= rowCenter;
        const distance = exitsRight ? rowRect.right - targetRect.left : targetRect.right - rowRect.left;
        setExitTranslate(Math.ceil(Math.max(0, distance + MESSAGE_ROW_EXIT_CLEARANCE_PX)) * (exitsRight ? 1 : -1));
        return afterNextPaint(() => setVisualExiting(true));
    }, [leaving]);

    return (
        <MessageRowShell ref={setRowRef} rowState={rowState} hasRowAbove={hasRowAbove} className={`${leaving ? '' : 'group'} flex w-full shrink-0 flex-col ${userSent ? 'items-end' : 'items-start'}`}>
            <div className={`flex w-full items-center gap-2 flex-row ${userSent ? 'justify-end' : 'justify-start'}`}>
                <div
                    data-message-exit-target
                    ref={exitTargetRef}
                    className={`relative max-w-[60%] flex min-w-0 flex-col ease-out ${userSent ? 'items-end' : 'items-start'}`}
                    style={{
                        transform: exitOuterTransform,
                        transition: `margin-right ${MESSAGE_ROW_ANIMATION_MS}ms ${MESSAGE_ROW_EASE}, transform ${MESSAGE_ROW_EXIT_ANIMATION_MS}ms ${MESSAGE_ROW_EXIT_EASE}`,
                        willChange: leaving ? 'transform' : undefined,
                        marginRight: 0,
                    }}
                >
                    <div
                        className={`flex min-w-0 flex-col ${userSent ? 'items-end' : 'items-start'}`}
                        style={{
                            opacity: visualExiting ? 0 : 1,
                            transform: exitInnerTransform,
                            transformOrigin: 'center',
                            transition: `opacity ${MESSAGE_ROW_EXIT_ANIMATION_MS}ms ease-out, transform ${MESSAGE_ROW_EXIT_ANIMATION_MS}ms ${MESSAGE_ROW_EXIT_EASE}`,
                            willChange: leaving ? 'opacity, transform' : undefined,
                        }}
                    >
                        <div className="flex min-w-0 items-center">
                            {fromPeer ? <MsgDot show={showMsgDot} failed={msg.failed} saved={dotSavedForever} side="left" /> : null}
                            {isReported ? (
                                <>
                                    <MessageActions actions={visibleActions} fromPeer={fromPeer} />
                                    <ReportedMessage fromPeer={fromPeer} />
                                </>
                            ) : (
                                <div className="relative min-w-0 max-w-full touch-manipulation" onPointerUp={leaving ? undefined : handlePointerUp}>
                                    <ChatMessageType
                                        msg={msg}
                                        fromPeer={fromPeer}
                                        peerChatPK={peerChatPK}
                                        peerDisplayName={peerDisplayName}
                                        onPay={handlePay}
                                        isPaying={isPaying}
                                        reply={reply}
                                        replyFromPeer={replyFromPeer}
                                        onReplyPress={handleReplyPress}
                                        reactions={reactions}
                                        reactionUsers={reactionUsers}
                                        actionSlot={<MessageActions actions={visibleActions} fromPeer={fromPeer} />}
                                    />
                                </div>
                            )}
                            {!fromPeer ? <MsgDot show={showMsgDot} failed={msg.failed} saved={dotSavedForever} side="right" /> : null}
                        </div>
                        <MessageMeta time={messageTime} receiptTime={receiptTime} receiptPeer={receiptPeer} userSent={userSent} />
                    </div>
                </div>
            </div>
        </MessageRowShell>
    );
}

const MemoMessageRow = memo(MessageRow);

export function MessageList({ onReply, onEdit, bottomPad = 96 }) {
    const { selectedChatId, updateMessage, retryMessage, makeMessagePermanent, makeMessageTemporary, readMessageFile, sendReaction } = useChat();
    const { avatar, chatPK } = useUser();
    const { peers } = usePeer();
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
    const peerProfile = useMemo(() => peers?.find((peer) => peer.chatPK === peerChatPK) ?? null, [peerChatPK, peers]);
    const peerDisplayName = useMemo(
        () =>
            formatUserDisplay({
                username: peerProfile?.username,
                walletPK: peerChatPK,
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

    const openDeleteDialog = useCallback(
        (msg) => {
            if (!selectedChatId || !msg?.id || String(msg.id).startsWith('local:')) {
                return;
            }

            openDialog('deletemessage', {
                chatId: selectedChatId,
                msg,
                onDeleting: startDeletingMessage,
                onDeleted: finishDeletingMessage,
                onDeleteFailed: clearDeletingMessage,
            });
        },
        [clearDeletingMessage, finishDeletingMessage, openDialog, selectedChatId, startDeletingMessage]
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
                            rowRefs={rowRefs}
                            getOptimisticReactions={getOptimisticReactions}
                            onReply={onReply}
                            onEdit={onEdit}
                            onRetry={retrySentMessage}
                            onDownload={saveMessage}
                            onSaveForever={toggleSaveForeverMessage}
                            onShare={openShareDialog}
                            onDelete={openDeleteDialog}
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
