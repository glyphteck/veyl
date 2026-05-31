'use client';

import { Bookmark, Download, Flag, Loader, Reply, RotateCcw, Share2, SquarePen, Trash2 } from 'lucide-react';
import { forwardRef, memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar, AvatarFallback, StaticAvatar } from '@/components/avatar';
import { canReplyToMsg, canShareAttachmentMsg, getSystemMsgText, isSystemMsg } from '@veyl/shared/chat/messages';
import { formatFullDateTime } from '@veyl/shared/utils/time';
import { bubbleBg, canSaveMsgFile } from '@/lib/chat/messages';
import { cn } from '@/lib/classes';
import { ChatMessageType } from './messages';
import MsgDot from './msgdot';
import {
    MESSAGE_ROW_ANIMATION_MS,
    MESSAGE_ROW_EASE,
    MESSAGE_ROW_EXIT_ANIMATION_MS,
    MESSAGE_ROW_EXIT_CLEARANCE_PX,
    MESSAGE_ROW_EXIT_EASE,
    MESSAGE_ROW_EXIT_SCALE,
    MESSAGE_ROW_GAP_PX,
    afterNextPaint,
} from './rowmotion';

const MESSAGE_ACTION_ICON = 'size-4';
const EMPTY_MESSAGE_ACTIONS = Object.freeze([]);

function ActionButton({ title, icon: Icon, className = 'text-muted', iconClassName = '', onClick, disabled = false }) {
    return (
        <button
            type="button"
            title={title}
            className={cn('grower-lg flex size-4 items-center justify-center rounded-full px-0 py-0 disabled:cursor-default disabled:opacity-50 disabled:hover:scale-100', className)}
            disabled={disabled}
            onClick={(event) => {
                event.stopPropagation();
                if (disabled) {
                    return;
                }
                onClick?.();
            }}
        >
            <Icon className={cn(MESSAGE_ACTION_ICON, iconClassName)} />
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

const MessageRowShell = forwardRef(function MessageRowShell({ rowState = 'present', hasRowAbove = false, gapPx = MESSAGE_ROW_GAP_PX, className, children }, ref) {
    const innerRef = useRef(null);
    const [height, setHeight] = useState(null);
    const [dropping, setDropping] = useState(false);
    const heightRef = useRef(null);
    const entering = rowState === 'entering';
    const dropped = rowState === 'leaving';
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

        if (dropped) {
            setDropping(false);
            setMeasuredHeight(measure());
            const dropTimeout = setTimeout(() => setDropping(true), MESSAGE_ROW_EXIT_ANIMATION_MS);
            return () => clearTimeout(dropTimeout);
        }

        setDropping(false);

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
    }, [dropped, entering, rowGap, setMeasuredHeight]);

    return (
        <div
            ref={ref}
            className={className}
            style={{
                height: height == null ? undefined : dropping ? 0 : height,
                overflow: entering ? 'hidden' : 'visible',
                position: dropped ? 'relative' : undefined,
                transition: instant ? 'none' : `height ${MESSAGE_ROW_ANIMATION_MS}ms ${MESSAGE_ROW_EASE}`,
                willChange: entering || dropped ? 'height' : undefined,
                pointerEvents: dropped ? 'none' : undefined,
            }}
        >
            <div
                ref={innerRef}
                style={{
                    width: '100%',
                    paddingTop: rowGap,
                    position: dropped ? 'absolute' : undefined,
                    top: dropped ? 0 : undefined,
                    left: dropped ? 0 : undefined,
                    right: dropped ? 0 : undefined,
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
    canSaveForever,
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
    const dropped = rowState === 'leaving';
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
                canSaveForever: canSaveForever && !isReported,
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
        [actionSavedForever, canReport, canSaveForever, isReported, isSaving, isSavingForever, msg, onDelete, onDownload, onEdit, onReply, onReport, onRetry, onSaveForever, onShare, peerChatPK, userSent]
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
    const visibleActions = dropped ? EMPTY_MESSAGE_ACTIONS : actions;
    const exitOuterTransform = visualExiting ? `translate3d(${exitTranslate}px, 0, 0)` : 'translate3d(0, 0, 0)';
    const exitInnerTransform = visualExiting ? `scale(${MESSAGE_ROW_EXIT_SCALE})` : 'scale(1)';

    useLayoutEffect(() => {
        if (!dropped) {
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
    }, [dropped]);

    return (
        <MessageRowShell ref={setRowRef} rowState={rowState} hasRowAbove={hasRowAbove} className={cn(!dropped && 'group', 'flex w-full shrink-0 flex-col', userSent ? 'items-end' : 'items-start')}>
            <div className={`flex w-full items-center gap-2 flex-row ${userSent ? 'justify-end' : 'justify-start'}`}>
                <div
                    data-message-exit-target
                    ref={exitTargetRef}
                    className={`relative max-w-[60%] flex min-w-0 flex-col ease-out ${userSent ? 'items-end' : 'items-start'}`}
                    style={{
                        transform: exitOuterTransform,
                        transition: `margin-right ${MESSAGE_ROW_ANIMATION_MS}ms ${MESSAGE_ROW_EASE}, transform ${MESSAGE_ROW_EXIT_ANIMATION_MS}ms ${MESSAGE_ROW_EXIT_EASE}`,
                        willChange: dropped ? 'transform' : undefined,
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
                            willChange: dropped ? 'opacity, transform' : undefined,
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
                                <div className="relative min-w-0 max-w-full touch-manipulation" onPointerUp={dropped ? undefined : handlePointerUp}>
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

export const MemoMessageRow = memo(MessageRow);
