import { ActivityIndicator, Alert, Text, View, useWindowDimensions } from 'react-native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { httpsCallable } from 'firebase/functions';
import { ArrowDown, Bookmark, Copy, Download, Flag, History, Reply, RotateCcw, Share2, SquarePen, Trash2 } from 'lucide-react-native';
import Animated, { Easing, LinearTransition, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useChat } from '@/providers/chatprovider';
import { useTheme } from '@/providers/themeprovider';
import { useMenu } from '@/providers/menuprovider';
import { useMediaViewer } from '@/providers/mediaviewerprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import GlassView from '@/components/glass/glassview';
import GlassIcon from '@/components/glass/glassicon';
import { KeyboardChatScrollView, KeyboardStickyView } from '@/components/keyboardscroll';
import { ChatMessageType, TextBubble } from '@/components/chat/messages';
import ReceiptMark, { RECEIPT_MARK_RESERVE } from '@/components/chat/receiptmark';
import { REACTION_SPACE } from '@/components/chat/messages/reactiontray';
import { MessageGestureProvider } from '@/components/chat/messagegesturecontext';
import Icon from '@/components/icon';
import { mark } from '@/lib/diagnostics';
import { useChatMessages } from '@/lib/usechatmessages';
import { uploadStorageBytesNative } from '@/lib/chatmedia';
import { getMediaViewerKey, isMediaViewerMsg } from '@/lib/chatmediaitems';
import { copyMessageImage, copyMessageText, saveMessageFile, saveMessageImage } from '@/lib/chatdownloads';
import { stageShareMedia } from '@/lib/sharemedia';
import { functions, storage } from '@/lib/firebase';
import { canReplyToMsg, canShareAttachmentMsg, canShowMsg, collapseSystemMessages, getLatestReadOutgoingReceipt, getSystemMsgText, isPeerMsg, isReadReceiptMsg, isSystemMsg, setReqTx } from '@glyphteck/shared/chat/messages';
import { useOptimisticMessageReactions } from '@glyphteck/shared/chat/usereactions';
import { makeFileId, reportEvidencePath } from '@glyphteck/shared/files';
import { buildReportFields, getReportAttachmentMeta } from '@glyphteck/shared/report';
import { formatTimeHHMM } from '@glyphteck/shared/utils';
import { getMessageOrderMs } from '@glyphteck/shared/chat/state';
import { CHAT_RETENTION_SEEN, getMessageRetention, onSeenMessageTtlMs, seenMessageTtlMs } from '@glyphteck/shared/chat/ttl';

const STAMP_W = 108;
const STAMP_WAIT = 12;
const STAMP_TRAY = STAMP_W + STAMP_WAIT;
const REPLY_DRAG = 24;
const REPLY_HINT_W = 44;
const REPLY_TRIGGER = 64;
const REPLY_ICON_DELAY = 24;
const NEWEST_MESSAGE_GAP = 8;
const SCROLL_BOTTOM_SHOW_MIN_DISTANCE = 360;
const SCROLL_BOTTOM_SHOW_PAGE_FRACTION = 1.25;
const SCROLL_BOTTOM_HIDE_PAGE_FRACTION = 1;
const SCROLL_BOTTOM_ANIMATION_MS = 160;
const SCROLL_BOTTOM_START_SCALE = 0.001;
const MESSAGE_ROW_ANIMATION_MS = 160;
const MESSAGE_ROW_ENTER_ANIMATION_MS = MESSAGE_ROW_ANIMATION_MS;
const MESSAGE_ROW_EXIT_ANIMATION_MS = 160;
const MESSAGE_ROW_SHRINK_ANIMATION_MS = MESSAGE_ROW_ANIMATION_MS;
const MESSAGE_ROW_LEAVE_MS = MESSAGE_ROW_EXIT_ANIMATION_MS + MESSAGE_ROW_SHRINK_ANIMATION_MS;
const MESSAGE_ROW_ENTER_STATE_MS = MESSAGE_ROW_ENTER_ANIMATION_MS + 120;
const MESSAGE_ROW_EASING = Easing.out(Easing.cubic);
const MESSAGE_ROW_EXIT_EASING = Easing.linear;
const MESSAGE_ROW_EXIT_CLEARANCE_PX = 1;
const MESSAGE_ROW_ENTER_SCALE = 0.2;
const MESSAGE_ROW_ENTER_OFFSET_Y = 10;
const MESSAGE_ROW_EXIT_SCALE = 0.01;
const LIKE_PREVIEW_INSET = 22;
const LIKE_BLOCK_MS = 320;
const MESSAGE_ROW_PADDING_TOP = 4;
const MESSAGE_ROW_PADDING_BOTTOM = 8;
const RECEIPT_STAMP_BOTTOM = 7;
const REPLY_SPRING = {
    mass: 0.16,
    stiffness: 200,
    damping: 4.5,
};
const MESSAGE_ROW_ENTER_TIMING = { duration: MESSAGE_ROW_ENTER_ANIMATION_MS, easing: MESSAGE_ROW_EASING };
const MESSAGE_ROW_LAYOUT = LinearTransition.duration(MESSAGE_ROW_ENTER_ANIMATION_MS).easing(MESSAGE_ROW_EASING);
const KEYBOARD_DISMISS_MODE = 'interactive';
const CHAT_KEYBOARD_GAP = 8;

function roundPx(value) {
    return Math.round(Number.isFinite(value) ? value : 0);
}

function positivePx(value) {
    return Math.max(0, roundPx(value));
}

function clamp(value, min, max) {
    'worklet';
    return Math.min(Math.max(value, min), max);
}

function rubberBand(value, dimension) {
    'worklet';
    if (value <= 0 || dimension <= 0) return 0;
    return (1 - 1 / (value / dimension + 1)) * dimension;
}

function revealReply(value) {
    'worklet';
    if (value <= 0) return 0;
    if (value <= REPLY_DRAG) return value;
    return REPLY_DRAG + rubberBand(value - REPLY_DRAG, REPLY_HINT_W);
}

function getMsgKey(msg) {
    return msg?.cid || msg?.id;
}

function getMsgKeys(msg) {
    return [...new Set([getMsgKey(msg), msg?.id, msg?.cid].filter(Boolean))];
}

function sameRowList(a, b) {
    if (a === b) {
        return true;
    }
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        if (a[index]?.key !== b[index]?.key || a[index]?.msg !== b[index]?.msg || a[index]?.state !== b[index]?.state || a[index]?.dotExitToken !== b[index]?.dotExitToken) {
            return false;
        }
    }
    return true;
}

function makePresentRows(messages) {
    return (messages || [])
        .map((msg) => ({
            key: getMsgKey(msg),
            msg,
            state: 'present',
            dotExitToken: 0,
        }))
        .filter((row) => row.key);
}

function shouldExitPendingDot(previous, next) {
    return !!((previous?.pending || previous?.failed) && next && !next.pending && !next.failed);
}

function useAnimatedMessageRows(messages, scopeKey, animate = true) {
    const presentRows = useMemo(() => makePresentRows(messages), [messages]);
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
                const confirmed = retained && shouldExitPendingDot(prevRow.msg, row.msg);
                const retainedState = prevRow?.state === 'entering' || prevRow?.state === 'instant' ? prevRow.state : 'present';
                const nextState = retained ? retainedState : index < newestInsertCount ? 'entering' : 'instant';
                const dotExitToken = confirmed ? (prevRow.dotExitToken || 0) + 1 : prevRow?.dotExitToken || 0;
                if (prevRow && prevRow.state === nextState && prevRow.msg === row.msg && prevRow.dotExitToken === dotExitToken) {
                    return prevRow;
                }
                return {
                    ...row,
                    state: nextState,
                    dotExitToken,
                };
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

    const { instantKeys, enteringKeys } = useMemo(() => {
        const instant = [];
        const entering = [];
        for (const row of state.rows) {
            if (row.state === 'instant') {
                instant.push(row.key);
            } else if (row.state === 'entering') {
                entering.push(row.key);
            }
        }
        return {
            instantKeys: instant.join('|'),
            enteringKeys: entering.join('|'),
        };
    }, [state.rows]);

    useEffect(() => {
        if (!state.animated || state.scopeKey !== scopeKey || !instantKeys) {
            return undefined;
        }

        const frame = requestAnimationFrame(() => {
            setState((prev) => {
                if (prev.scopeKey !== scopeKey) {
                    return prev;
                }
                return {
                    ...prev,
                    rows: prev.rows.map((row) => (row.state === 'instant' ? { ...row, state: 'present' } : row)),
                };
            });
        });
        return () => cancelAnimationFrame(frame);
    }, [instantKeys, scopeKey, state.animated, state.scopeKey]);

    useEffect(() => {
        if (!state.animated || state.scopeKey !== scopeKey || !enteringKeys) {
            return undefined;
        }

        const keys = new Set(enteringKeys.split('|').filter(Boolean));
        const timeout = setTimeout(() => {
            setState((prev) => {
                if (prev.scopeKey !== scopeKey) {
                    return prev;
                }
                return {
                    ...prev,
                    rows: prev.rows.map((row) => (row.state === 'entering' && keys.has(row.key) ? { ...row, state: 'present' } : row)),
                };
            });
        }, MESSAGE_ROW_ENTER_STATE_MS);

        return () => clearTimeout(timeout);
    }, [enteringKeys, scopeKey, state.animated, state.scopeKey]);

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
        for (const key of getMsgKeys(item)) {
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

function getMsgStamp(msg) {
    const ms = getMessageOrderMs(msg);
    return Number.isFinite(ms) && ms !== Infinity ? formatTimeHHMM(ms, true) : '';
}

function hasMsgText(msg) {
    return typeof msg?.c === 'string' && msg.c.trim().length > 0;
}

function hasMsgFile(msg) {
    return (typeof msg?.localUri === 'string' && msg.localUri.trim().length > 0) || (typeof msg?.p === 'string' && !!msg.p && typeof msg?.k === 'string' && !!msg.k);
}

function useLeavingRowCollapse(leaving) {
    const rowHeight = useSharedValue(0);
    const collapse = useSharedValue(0);
    const shrinkTimerRef = useRef(null);

    const clearShrinkTimer = useCallback(() => {
        if (shrinkTimerRef.current) {
            clearTimeout(shrinkTimerRef.current);
            shrinkTimerRef.current = null;
        }
    }, []);

    const handleRowLayout = useCallback(
        (event) => {
            if (leaving) {
                return;
            }
            const height = roundPx(event?.nativeEvent?.layout?.height);
            if (height > 0) {
                rowHeight.value = height;
            }
        },
        [leaving, rowHeight]
    );

    useEffect(() => {
        clearShrinkTimer();
        if (!leaving) {
            collapse.value = 0;
            return undefined;
        }

        collapse.value = 0;
        shrinkTimerRef.current = setTimeout(() => {
            shrinkTimerRef.current = null;
            collapse.value = withTiming(1, {
                duration: MESSAGE_ROW_SHRINK_ANIMATION_MS,
                easing: MESSAGE_ROW_EASING,
            });
        }, MESSAGE_ROW_EXIT_ANIMATION_MS);

        return clearShrinkTimer;
    }, [clearShrinkTimer, collapse, leaving]);

    const rowCollapseStyle = useAnimatedStyle(() => {
        if (!leaving || rowHeight.value <= 0) {
            return {};
        }
        return {
            height: Math.max(0, rowHeight.value * (1 - collapse.value)),
        };
    });

    return { handleRowLayout, rowCollapseStyle };
}

function MsgDot({ show, failed, saved = false, side = 'right', bottomInset = 0, exitToken = 0, theme }) {
    const progress = useSharedValue(exitToken ? 1 : 0);
    const bottomOffset = useSharedValue(bottomInset);
    const [visualSaved, setVisualSaved] = useState(saved);
    const bottomOffsetTimerRef = useRef(null);

    const clearBottomOffsetTimer = useCallback(() => {
        if (bottomOffsetTimerRef.current) {
            clearTimeout(bottomOffsetTimerRef.current);
            bottomOffsetTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        progress.value = withTiming(show ? 1 : 0, { duration: MESSAGE_ROW_ANIMATION_MS, easing: MESSAGE_ROW_EASING });
    }, [progress, show]);

    useEffect(() => {
        clearBottomOffsetTimer();
        const nextInset = positivePx(bottomInset);
        const timing = { duration: MESSAGE_ROW_ANIMATION_MS, easing: MESSAGE_ROW_EASING };
        if (nextInset < bottomOffset.value) {
            bottomOffsetTimerRef.current = setTimeout(() => {
                bottomOffsetTimerRef.current = null;
                bottomOffset.value = withTiming(nextInset, timing);
            }, MESSAGE_ROW_ANIMATION_MS);
            return undefined;
        }

        bottomOffset.value = withTiming(nextInset, timing);
        return undefined;
    }, [bottomInset, bottomOffset, clearBottomOffsetTimer]);

    useEffect(() => {
        if (show || saved) {
            setVisualSaved(saved);
            return undefined;
        }

        const timeout = setTimeout(() => setVisualSaved(false), MESSAGE_ROW_ANIMATION_MS);
        return () => clearTimeout(timeout);
    }, [saved, show]);

    useEffect(() => clearBottomOffsetTimer, [clearBottomOffsetTimer]);

    const dotSpaceStyle = useAnimatedStyle(() => ({
        marginLeft: side === 'right' ? 8 * progress.value : 0,
        marginRight: side === 'left' ? 8 * progress.value : 0,
        marginBottom: bottomOffset.value,
        width: 8 * progress.value,
    }));
    const dotVisualStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 0.01 + 0.99 * progress.value }],
    }));

    const tintColor = failed ? theme.destructive : saved || visualSaved ? theme.foreground : theme.active;

    return (
        <Animated.View
            pointerEvents="none"
            style={[
                {
                    width: 0,
                    height: 8,
                    alignSelf: 'center',
                    overflow: 'visible',
                },
                dotSpaceStyle,
            ]}
        >
            <Animated.View
                style={[
                    {
                        position: 'absolute',
                        top: 0,
                        left: side === 'right' ? 0 : undefined,
                        right: side === 'left' ? 0 : undefined,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        overflow: 'hidden',
                    },
                    dotVisualStyle,
                ]}
            >
                <GlassView glassEffectStyle="regular" tintColor={tintColor} style={{ width: 8, height: 8, minWidth: 8, minHeight: 8, borderRadius: 4, overflow: 'hidden' }} />
            </Animated.View>
        </Animated.View>
    );
}

function ReportedBubble({ fromPeer = false }) {
    return <TextBubble msg={{ c: 'reported message hidden' }} fromPeer={fromPeer} />;
}

function MessageRow({ chatPad, msg, rowState = 'present', fromPeer = false, theme, timeGesture, screenW, receiptStamp, stampBottomInset = 0, onReply, onLike, children }) {
    const reply = useSharedValue(0);
    const appear = useSharedValue(rowState === 'entering' ? 0 : 1);
    const exit = useSharedValue(0);
    const exitDistance = useSharedValue(0);
    const [swipeBlocked, setSwipeBlocked] = useState(false);
    const exitContentLayoutRef = useRef(null);
    const exitTargetLayoutRef = useRef(null);
    const likeBlockedRef = useRef(false);
    const likeBlockTimerRef = useRef(null);
    const stamp = useMemo(() => getMsgStamp(msg), [msg?.cid, msg?.id, msg?.ts]);
    const leaving = rowState === 'leaving';
    const entering = rowState === 'entering';
    const instant = rowState === 'instant';
    const canReply = !leaving && typeof onReply === 'function';
    const canLike = !leaving && typeof onLike === 'function';
    const hasPan = canReply;
    const replyIconLeft = fromPeer;
    const { handleRowLayout, rowCollapseStyle } = useLeavingRowCollapse(leaving);
    const triggerReply = useCallback(() => {
        Haptics.selectionAsync().catch(() => {});
        onReply?.(msg);
    }, [msg, onReply]);
    const triggerLike = useCallback(() => {
        Haptics.selectionAsync().catch(() => {});
        onLike?.(msg);
    }, [msg, onLike]);
    const blockLike = useCallback((duration = LIKE_BLOCK_MS) => {
        if (likeBlockTimerRef.current) {
            clearTimeout(likeBlockTimerRef.current);
            likeBlockTimerRef.current = null;
        }
        likeBlockedRef.current = true;
        likeBlockTimerRef.current = setTimeout(() => {
            likeBlockTimerRef.current = null;
            likeBlockedRef.current = false;
        }, duration);
    }, []);

    useEffect(
        () => () => {
            if (likeBlockTimerRef.current) {
                clearTimeout(likeBlockTimerRef.current);
                likeBlockTimerRef.current = null;
            }
            likeBlockedRef.current = false;
        },
        []
    );

    const replyStyle = useAnimatedStyle(() => {
        const reveal = clamp((Math.abs(reply.value) - REPLY_ICON_DELAY) / 42, 0, 1);
        return {
            opacity: reveal,
            transform: [{ scale: 0.84 + reveal * 0.24 }],
        };
    });

    const contentStyle = useAnimatedStyle(() => {
        const exitTranslate = exitDistance.value * exit.value;
        const exitScale = 1 - exit.value * (1 - MESSAGE_ROW_EXIT_SCALE);
        const enterScale = MESSAGE_ROW_ENTER_SCALE + appear.value * (1 - MESSAGE_ROW_ENTER_SCALE);
        const enterOffsetY = (1 - appear.value) * MESSAGE_ROW_ENTER_OFFSET_Y;
        return {
            transform: [{ translateX: reply.value + exitTranslate }, { translateY: exit.value > 0 ? 0 : enterOffsetY }, { scale: exit.value > 0 ? exitScale : enterScale }],
        };
    });

    const handleExitContentLayout = useCallback((event) => {
        exitContentLayoutRef.current = event.nativeEvent.layout;
    }, []);

    const handleExitTargetLayout = useCallback((event) => {
        exitTargetLayoutRef.current = event.nativeEvent.layout;
    }, []);

    const measureExitTranslate = useCallback(() => {
        const contentLayout = exitContentLayoutRef.current;
        const targetLayout = exitTargetLayoutRef.current || contentLayout;
        if (!contentLayout || !targetLayout || !Number.isFinite(contentLayout.x) || !Number.isFinite(targetLayout.x) || !Number.isFinite(targetLayout.width) || targetLayout.width <= 0) {
            return (screenW + MESSAGE_ROW_EXIT_CLEARANCE_PX) * (fromPeer ? -1 : 1);
        }

        const targetLeft = contentLayout.x + targetLayout.x;
        const targetRight = targetLeft + targetLayout.width;
        const exitsRight = !fromPeer;
        const distance = exitsRight ? screenW - targetLeft : targetRight;
        return Math.ceil(Math.max(0, distance + MESSAGE_ROW_EXIT_CLEARANCE_PX)) * (exitsRight ? 1 : -1);
    }, [fromPeer, screenW]);

    useEffect(() => {
        if (leaving) {
            appear.value = 1;
            exitDistance.value = measureExitTranslate();
            exit.value = withTiming(1, { duration: MESSAGE_ROW_EXIT_ANIMATION_MS, easing: MESSAGE_ROW_EXIT_EASING });
            return undefined;
        }

        exit.value = 0;
        exitDistance.value = 0;
        if (instant) {
            appear.value = 1;
            return undefined;
        }
        if (!entering) {
            appear.value = 1;
            return undefined;
        }

        appear.value = 0;
        appear.value = withTiming(1, MESSAGE_ROW_ENTER_TIMING);
        return undefined;
    }, [appear, entering, exit, exitDistance, instant, leaving, measureExitTranslate]);

    const replyGesture = useMemo(() => {
        const gesture = Gesture.Pan()
            .enabled(canReply && !swipeBlocked)
            .activeOffsetX(fromPeer ? 4 : -4)
            .failOffsetY([-10, 10])
            .failOffsetX(fromPeer ? -4 : 4);
        if (!fromPeer && timeGesture) {
            gesture.blocksExternalGesture(timeGesture);
        }
        return gesture
            .onUpdate((event) => {
                'worklet';
                const drag = fromPeer ? Math.max(event.translationX, 0) : Math.max(-event.translationX, 0);
                reply.value = fromPeer ? revealReply(drag) : -revealReply(drag);
            })
            .onEnd((event) => {
                'worklet';
                const drag = fromPeer ? event.translationX : -event.translationX;
                if (drag >= REPLY_TRIGGER && canReply) {
                    scheduleOnRN(triggerReply);
                }
            })
            .onFinalize(() => {
                'worklet';
                reply.value = withSpring(0, REPLY_SPRING);
            });
    }, [canReply, fromPeer, reply, swipeBlocked, timeGesture, triggerReply]);

    const likeGesture = useMemo(
        () =>
            Gesture.Tap()
                .enabled(canLike)
                .numberOfTaps(2)
                .maxDelay(280)
                .maxDistance(18)
                .runOnJS(true)
                .onEnd((_event, success) => {
                    if (success && !likeBlockedRef.current) {
                        triggerLike();
                    }
                }),
        [canLike, triggerLike]
    );

    const tapGesture = useMemo(() => (canLike ? likeGesture : null), [canLike, likeGesture]);

    const rowGesture = useMemo(() => {
        if (hasPan && tapGesture) {
            return Gesture.Simultaneous(replyGesture, tapGesture);
        }
        if (hasPan) {
            return replyGesture;
        }
        return tapGesture;
    }, [hasPan, replyGesture, tapGesture]);

    const gestureValue = useMemo(() => ({ blockLike, setSwipeBlocked }), [blockLike, setSwipeBlocked]);
    const renderedChildren = typeof children === 'function' ? children({ onExitTargetLayout: handleExitTargetLayout }) : children;
    const content = <MessageGestureProvider value={gestureValue}>{renderedChildren}</MessageGestureProvider>;
    const contentOriginStyle = useMemo(() => ({ transformOrigin: fromPeer ? 'left bottom' : 'right bottom' }), [fromPeer]);
    const contentNode = (
        <Animated.View collapsable={false} onLayout={handleExitContentLayout} style={[contentOriginStyle, contentStyle]}>
            {content}
        </Animated.View>
    );
    const rowBody = (
        <View
            collapsable={false}
            style={{
                position: 'relative',
                width: screenW + STAMP_TRAY,
                paddingTop: MESSAGE_ROW_PADDING_TOP,
                paddingBottom: MESSAGE_ROW_PADDING_BOTTOM,
            }}
        >
            {stamp ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: screenW + STAMP_WAIT,
                        top: MESSAGE_ROW_PADDING_TOP,
                        bottom: MESSAGE_ROW_PADDING_BOTTOM + stampBottomInset,
                        width: STAMP_W,
                        justifyContent: 'center',
                        alignItems: 'flex-start',
                    }}
                >
                    <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '800' }}>{stamp}</Text>
                </View>
            ) : null}
            {receiptStamp ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: screenW + STAMP_WAIT,
                        bottom: RECEIPT_STAMP_BOTTOM,
                        width: STAMP_W,
                        justifyContent: 'center',
                        alignItems: 'flex-start',
                    }}
                >
                    <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '800' }}>{receiptStamp}</Text>
                </View>
            ) : null}
            {canReply ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        {
                            position: 'absolute',
                            left: replyIconLeft ? 12 : undefined,
                            right: replyIconLeft ? undefined : STAMP_TRAY + Math.max(chatPad - 4, 12),
                            top: 0,
                            bottom: 0,
                            width: REPLY_HINT_W,
                            justifyContent: 'center',
                            alignItems: 'center',
                        },
                        replyStyle,
                    ]}
                >
                    <Icon icon={Reply} color={theme.foreground} />
                </Animated.View>
            ) : null}
            <View style={{ width: screenW, paddingHorizontal: chatPad, flexDirection: 'row', justifyContent: fromPeer ? 'flex-start' : 'flex-end' }}>
                {rowGesture ? (
                    <GestureDetector gesture={rowGesture}>{contentNode}</GestureDetector>
                ) : (
                    contentNode
                )}
            </View>
        </View>
    );

    return (
        <Animated.View
            collapsable={false}
            onLayout={handleRowLayout}
            pointerEvents={leaving ? 'none' : 'auto'}
            style={[
                {
                    width: screenW + STAMP_TRAY,
                    overflow: 'hidden',
                },
                rowCollapseStyle,
            ]}
        >
            {rowBody}
        </Animated.View>
    );
}

function SystemMessageRow({ chatPad, msg, rowState = 'present', screenW, theme }) {
    const appear = useSharedValue(rowState === 'entering' ? 0 : 1);
    const exit = useSharedValue(0);
    const leaving = rowState === 'leaving';
    const entering = rowState === 'entering';
    const instant = rowState === 'instant';
    const { handleRowLayout, rowCollapseStyle } = useLeavingRowCollapse(leaving);
    const visualStyle = useAnimatedStyle(() => ({
        opacity: 1 - exit.value,
        transform: [
            { translateY: exit.value > 0 ? 0 : (1 - appear.value) * MESSAGE_ROW_ENTER_OFFSET_Y },
            { scale: exit.value > 0 ? 1 - exit.value * (1 - MESSAGE_ROW_EXIT_SCALE) : MESSAGE_ROW_ENTER_SCALE + appear.value * (1 - MESSAGE_ROW_ENTER_SCALE) },
        ],
    }));

    useEffect(() => {
        if (leaving) {
            appear.value = 1;
            exit.value = withTiming(1, { duration: MESSAGE_ROW_EXIT_ANIMATION_MS, easing: MESSAGE_ROW_EXIT_EASING });
            return undefined;
        }

        exit.value = 0;
        if (instant) {
            appear.value = 1;
            return undefined;
        }
        if (!entering) {
            appear.value = 1;
            return undefined;
        }

        appear.value = 0;
        appear.value = withTiming(1, MESSAGE_ROW_ENTER_TIMING);
        return undefined;
    }, [appear, entering, exit, instant, leaving]);

    const rowBody = (
        <View
            collapsable={false}
            style={{
                width: screenW + STAMP_TRAY,
                paddingTop: 2,
                paddingBottom: 4,
            }}
        >
            <Animated.View collapsable={false} style={[{ width: screenW, paddingHorizontal: chatPad, alignItems: 'center', transformOrigin: 'center bottom' }, visualStyle]}>
                <Text style={{ maxWidth: '76%', color: theme.muted, fontSize: 11, fontWeight: '800', lineHeight: 14, textAlign: 'center' }}>{getSystemMsgText(msg)}</Text>
            </Animated.View>
        </View>
    );

    return (
        <Animated.View
            onLayout={handleRowLayout}
            pointerEvents={leaving ? 'none' : 'auto'}
            style={[
                {
                    width: screenW + STAMP_TRAY,
                    overflow: 'hidden',
                },
                rowCollapseStyle,
            ]}
        >
            {rowBody}
        </Animated.View>
    );
}

export default function MessageList({
    chatId,
    chatPad = 16,
    chatTitle,
    children,
    extraContentPadding,
    inputH = 48,
    onRequestHold,
    peerAvatarSource,
    peerBot = false,
    peerChatPK,
    peerUid,
    peerWalletPK,
    onReply,
    onEdit,
}) {
    const router = useRouter();
    const { avatar, chatPK, uid } = useUser();
    const { theme } = useTheme();
    const { active: menuActive } = useMenu();
    const { setMediaItems } = useMediaViewer();
    const { updateMessage, deleteMessage, retryMessage, makeMessagePermanent, makeMessageTemporary, readMessageFile, sendReaction } = useChat();
    const { sendMoneyWithSpark } = useWallet();
    const insets = useSafeAreaInsets();
    const { width: screenW } = useWindowDimensions();
    const { messages: messagesAsc, ready, hasOlder, loadingOlder, loadOlder, patchMessage, removeMessage } = useChatMessages(chatId);
    const submitReport = useMemo(() => httpsCallable(functions, 'submitReport'), []);
    const [payingMessages, setPayingMessages] = useState(new Set());
    const [savingForeverMessages, setSavingForeverMessages] = useState(new Map());
    const [reportedMessageKeys, setReportedMessageKeys] = useState(new Set());
    const [deletingMessageIds, setDeletingMessageIds] = useState(new Set());
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const [scrollBottomMounted, setScrollBottomMounted] = useState(false);
    const time = useSharedValue(0);
    const scrollBottomProgress = useSharedValue(0);
    const receiptSnapshotRef = useRef(new Map());
    const receiptSnapshotChatRef = useRef('');
    if (receiptSnapshotChatRef.current !== (chatId || '')) {
        receiptSnapshotChatRef.current = chatId || '';
        receiptSnapshotRef.current.clear();
    }
    const userAvatarSource = useMemo(() => (avatar ? { uri: avatar } : null), [avatar]);
    const reactionUsers = useMemo(
        () => ({
            ...(chatPK ? { [chatPK]: { source: userAvatarSource } } : {}),
            ...(peerChatPK ? { [peerChatPK]: { source: peerAvatarSource, bot: peerBot } } : {}),
        }),
        [chatPK, peerAvatarSource, peerBot, peerChatPK, userAvatarSource]
    );
    const {
        getReactions: getOptimisticReactions,
        toggleReaction: toggleOptimisticReaction,
    } = useOptimisticMessageReactions({
        chatId,
        chatPK,
        peerChatPK,
        messages: messagesAsc,
        sendReaction,
        onError: (error) => console.warn('message like failed', error),
    });
    const activeMessagesAsc = useMemo(() => (messagesAsc || []).filter((msg) => !msg?.id || !deletingMessageIds.has(msg.id)), [deletingMessageIds, messagesAsc]);
    const visibleMessagesAsc = useMemo(() => collapseSystemMessages(activeMessagesAsc.filter(canShowMsg)), [activeMessagesAsc]);
    const messages = useMemo(() => [...visibleMessagesAsc].reverse(), [visibleMessagesAsc]);
    const displayRows = useAnimatedMessageRows(messages, chatId || '', ready);
    const rowLayoutAnimation = useMemo(() => (displayRows.some((row) => row?.state === 'entering') ? MESSAGE_ROW_LAYOUT : undefined), [displayRows]);
    const latestReadReceipt = useMemo(() => getLatestReadOutgoingReceipt(activeMessagesAsc, chatPK, peerChatPK), [activeMessagesAsc, chatPK, peerChatPK]);
    const latestReadReceiptKey = getMsgKey(latestReadReceipt?.message);
    const latestReadReceiptStamp = useMemo(() => getMsgStamp(latestReadReceipt?.receipt), [latestReadReceipt?.receipt?.cid, latestReadReceipt?.receipt?.id, latestReadReceipt?.receipt?.ts]);
    const latestReceiptMeta = useMemo(
        () =>
            latestReadReceiptKey
                ? {
                      bot: peerBot,
                      source: peerAvatarSource,
                      stamp: latestReadReceiptStamp,
                  }
                : null,
        [latestReadReceiptKey, latestReadReceiptStamp, peerAvatarSource, peerBot]
    );
    const leavingReceiptKeys = useMemo(() => displayRows.filter((row) => row?.state === 'leaving' && row?.key).map((row) => row.key), [displayRows]);

    useEffect(() => {
        const retainedKeys = new Set(leavingReceiptKeys);
        if (latestReadReceiptKey && latestReceiptMeta) {
            receiptSnapshotRef.current.set(latestReadReceiptKey, latestReceiptMeta);
            retainedKeys.add(latestReadReceiptKey);
        }
        for (const key of receiptSnapshotRef.current.keys()) {
            if (!retainedKeys.has(key)) {
                receiptSnapshotRef.current.delete(key);
            }
        }
    }, [latestReadReceiptKey, latestReceiptMeta, leavingReceiptKeys]);

    useEffect(() => {
        setSavingForeverMessages((prev) => {
            if (!prev.size) {
                return prev;
            }

            const byKey = new Map();
            for (const message of messagesAsc || []) {
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
    }, [messagesAsc]);
    const mediaItems = useMemo(
        () =>
            visibleMessagesAsc
                .filter((msg) => {
                    const key = getMsgKey(msg);
                    return isMediaViewerMsg(msg) && hasMsgFile(msg) && (!key || !reportedMessageKeys.has(key));
                })
                .map((msg) => ({
                    id: getMediaViewerKey(peerChatPK, msg),
                    type: msg.t,
                    msg,
                    peerChatPK,
                    readMessageFile,
                }))
                .filter((item) => item.id),
        [peerChatPK, readMessageFile, reportedMessageKeys, visibleMessagesAsc]
    );
    const replyMap = useMemo(() => {
        const map = new Map();
        for (const msg of visibleMessagesAsc || []) {
            if (msg?.id) {
                map.set(msg.id, msg);
            }
            if (msg?.cid) {
                map.set(msg.cid, msg);
            }
        }
        return map;
    }, [visibleMessagesAsc]);
    const listRef = useRef(null);
    const loadingOlderRef = useRef(false);
    const stickyOffset = useMemo(() => ({ closed: 0, opened: insets.bottom - CHAT_KEYBOARD_GAP }), [insets.bottom]);
    const renderScrollComponent = useCallback((props) => <KeyboardChatScrollView {...props} inverted />, []);
    const scrollBottomBase = positivePx(insets.bottom + inputH + 20);
    const composerReserveStyle = useAnimatedStyle(() => {
        const extra = extraContentPadding ? extraContentPadding.value : 0;
        return { height: Math.max(0, Math.round(extra)) };
    }, [extraContentPadding]);
    const scrollBottomStyle = useAnimatedStyle(() => ({
        transform: [
            {
                scale: SCROLL_BOTTOM_START_SCALE + (1 - SCROLL_BOTTOM_START_SCALE) * scrollBottomProgress.value,
            },
        ],
    }));
    const scrollBottomPositionStyle = useAnimatedStyle(() => {
        const extra = extraContentPadding ? extraContentPadding.value : 0;
        return { bottom: Math.max(0, Math.round(scrollBottomBase + extra)) };
    }, [extraContentPadding, scrollBottomBase]);

    useEffect(() => {
        let timer;

        if (showScrollBottom) {
            setScrollBottomMounted(true);
            scrollBottomProgress.value = withTiming(1, {
                duration: SCROLL_BOTTOM_ANIMATION_MS,
                easing: Easing.out(Easing.cubic),
            });
            return undefined;
        }

        scrollBottomProgress.value = withTiming(0, {
            duration: SCROLL_BOTTOM_ANIMATION_MS,
            easing: Easing.in(Easing.cubic),
        });
        timer = setTimeout(() => setScrollBottomMounted(false), SCROLL_BOTTOM_ANIMATION_MS);
        return () => clearTimeout(timer);
    }, [scrollBottomProgress, showScrollBottom]);

    useEffect(() => {
        setMediaItems([]);
        loadingOlderRef.current = false;
        setShowScrollBottom(false);
        mark('chat.list.mount', { chatId: chatId || '' });
        return () => {
            mark('chat.list.unmount', { chatId: chatId || '' });
        };
    }, [chatId, setMediaItems]);

    useEffect(() => {
        mark('chat.list.state', {
            chatId: chatId || '',
            ready: !!ready,
            messages: messagesAsc?.length || 0,
            visible: visibleMessagesAsc.length,
            rows: displayRows.length,
            hasOlder: !!hasOlder,
            loadingOlder: !!loadingOlder,
        });
    }, [chatId, displayRows.length, hasOlder, loadingOlder, messagesAsc?.length, ready, visibleMessagesAsc.length]);

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

    useEffect(() => {
        setMediaItems(mediaItems);
    }, [mediaItems, setMediaItems]);

    useEffect(() => () => setMediaItems([]), [setMediaItems]);

    const timeStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: -time.value }],
    }));

    const handleListScroll = useCallback((event) => {
        const y = Number(event?.nativeEvent?.contentOffset?.y) || 0;
        const page = Number(event?.nativeEvent?.layoutMeasurement?.height) || 0;
        const distance = Math.abs(y);
        const showDistance = Math.max(SCROLL_BOTTOM_SHOW_MIN_DISTANCE, page * SCROLL_BOTTOM_SHOW_PAGE_FRACTION);
        const hideDistance = page * SCROLL_BOTTOM_HIDE_PAGE_FRACTION;
        setShowScrollBottom((show) => (show ? distance > hideDistance : distance > showDistance));
    }, []);

    const scrollToBottom = useCallback(() => {
        listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
        setShowScrollBottom(false);
    }, []);

    const timeGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetX(-4)
                .failOffsetX(4)
                .failOffsetY([-10, 10])
                .onUpdate((event) => {
                    'worklet';
                    time.value = Math.min(rubberBand(Math.max(-event.translationX, 0), STAMP_TRAY), STAMP_TRAY);
                })
                .onFinalize(() => {
                    'worklet';
                    time.value = withSpring(0, REPLY_SPRING);
                }),
        [time]
    );

    const promptReportNote = useCallback((title, onSubmit) => {
        Alert.prompt(
            title,
            'We will manually review this report and will have access to the content you are reporting.',
            [
                { text: 'cancel', style: 'cancel' },
                {
                    text: 'report',
                    style: 'destructive',
                    onPress: (value) => {
                        void onSubmit?.(value);
                    },
                },
            ],
            'plain-text'
        );
    }, []);

    const runReport = useCallback(
        async ({ uid, type, content, path, note, onDone }) => {
            try {
                await submitReport({
                    uid,
                    ...(type ? { type } : {}),
                    ...(content ? { content } : {}),
                    ...(path ? { path } : {}),
                    ...(note ? { note } : {}),
                });
                onDone?.();
                Alert.alert('Reported', 'We received the report.');
            } catch (error) {
                console.warn('report failed', error);
                Alert.alert('Report failed', error?.message || 'Could not submit this report.');
            }
        },
        [submitReport]
    );

    const handleReportMessage = useCallback(
        async (msg, note) => {
            if (!peerUid) return;
            const report = buildReportFields({ msg, note });
            const attachment = getReportAttachmentMeta(msg);

            try {
                let path;

                if (attachment && uid && peerChatPK) {
                    const bytes = await readMessageFile(peerChatPK, msg);
                    const nextPath = reportEvidencePath(uid, peerUid, makeFileId(12));
                    await uploadStorageBytesNative(storage, nextPath, bytes, {
                        contentType: attachment.mimeType || 'application/octet-stream',
                        cacheControl: 'private, max-age=0, no-transform',
                        customMetadata: {
                            ...(attachment.name ? { name: attachment.name } : {}),
                            ...(attachment.kind ? { kind: attachment.kind } : {}),
                        },
                    });
                    path = nextPath;
                }

                await runReport({
                    uid: peerUid,
                    ...report,
                    ...(path ? { path } : {}),
                    onDone: () => {
                        const key = getMsgKey(msg);
                        if (!key) return;
                        setReportedMessageKeys((prev) => {
                            const next = new Set(prev);
                            next.add(key);
                            return next;
                        });
                    },
                });
            } catch (error) {
                console.warn('report evidence upload failed', error);
                Alert.alert('Report failed', error?.message || 'Could not submit this report.');
            }
        },
        [peerChatPK, peerUid, readMessageFile, runReport, uid]
    );

    const handleDeleteMessage = useCallback(
        async (msg) => {
            if (!chatId || !msg?.id || String(msg.id).startsWith('local:')) {
                return;
            }

            setDeletingMessageIds((prev) => {
                if (prev.has(msg.id)) {
                    return prev;
                }
                const next = new Set(prev);
                next.add(msg.id);
                return next;
            });

            try {
                await deleteMessage(chatId, msg.id);
                removeMessage(msg.id);
            } catch (error) {
                console.warn('delete message failed', error);
                setDeletingMessageIds((prev) => {
                    if (!prev.has(msg.id)) {
                        return prev;
                    }
                    const next = new Set(prev);
                    next.delete(msg.id);
                    return next;
                });
                Alert.alert('Delete failed', error?.message || 'Could not delete this message.');
                return;
            }

            setDeletingMessageIds((prev) => {
                if (!prev.has(msg.id)) {
                    return prev;
                }
                const next = new Set(prev);
                next.delete(msg.id);
                return next;
            });
        },
        [chatId, deleteMessage, removeMessage]
    );

    const openShareRoute = useCallback(
        (msg) => {
            const params = stageShareMedia(msg);
            if (!params) {
                return;
            }
            router.push({ pathname: '/sharemedia', params });
        },
        [router]
    );

    const jumpToReply = useCallback(
        (replyId) => {
            const key = String(replyId ?? '').trim();
            if (!key) {
                return;
            }
            const index = displayRows.findIndex((row) => row?.state !== 'leaving' && (row?.msg?.id === key || row?.msg?.cid === key));
            if (index === -1) {
                return;
            }
            listRef.current?.scrollToIndex?.({
                index,
                animated: true,
                viewPosition: 0.5,
            });
        },
        [displayRows, listRef]
    );

    const toggleSaveForeverMessage = useCallback(
        async (msg) => {
            if (!chatId || !peerChatPK || !canToggleSaveForeverMsg(msg)) {
                return;
            }

            const key = getMsgKey(msg);
            const saved = isSavedForeverMsg(msg);
            const targetSaved = !saved;
            const unsaveTtlMs = saved ? getUnsaveTtlMs(msg, messagesAsc, chatPK, peerChatPK) : null;

            if (key) {
                setSavingForeverMessages((prev) => new Map(prev).set(key, targetSaved));
            }

            try {
                if (saved) {
                    await makeMessageTemporary?.(chatId, msg, peerChatPK, { ttlMs: unsaveTtlMs });
                } else {
                    await makeMessagePermanent?.(chatId, msg, peerChatPK);
                }
            } catch (error) {
                console.warn('message save forever update failed', error);
                Alert.alert(saved ? 'Unsave failed' : 'Save failed', error?.message || 'Could not update this message.');
                if (key) {
                    setSavingForeverMessages((prev) => {
                        const next = new Map(prev);
                        next.delete(key);
                        return next;
                    });
                }
            }
        },
        [chatId, chatPK, makeMessagePermanent, makeMessageTemporary, messagesAsc, peerChatPK]
    );

    const getMenuItems = useCallback(
        (msg) => {
            const fromPeer = isPeerMsg(msg, chatPK);
            const msgKey = getMsgKey(msg);
            const savingForever = !!msgKey && savingForeverMessages.has(msgKey);
            const savedForever = savingForever ? savingForeverMessages.get(msgKey) === true : isSavedForeverMsg(msg);
            const canReport = fromPeer && !!peerUid && msg?.t !== 'req';
            const isFailedSelf = !fromPeer && msg.failed;
            const canDelete = !!msg?.id && !String(msg.id).startsWith('local:');
            const canEdit = !fromPeer && msg?.t === 'txt' && hasMsgText(msg);
            const canReply = canReplyToMsg(msg);
            const canShare = canShareAttachmentMsg(msg);
            const canSaveForever = canToggleSaveForeverMsg(msg);
            const items = [];

            if (canReply && typeof onReply === 'function') {
                items.push({ id: 'reply', title: 'Reply', icon: Reply, run: () => onReply(msg) });
            }

            if (canSaveForever) {
                items.push({ id: 'save-forever', title: savedForever ? 'Unsave' : 'Save', icon: Bookmark, disabled: savingForever, run: () => toggleSaveForeverMessage(msg) });
            }

            switch (msg?.t) {
                case 'txt':
                    if (hasMsgText(msg)) {
                        items.push({ id: 'copy', title: 'Copy', icon: Copy, run: () => copyMessageText(msg) });
                        if (canEdit && typeof onEdit === 'function') {
                            items.push({ id: 'edit', title: 'Edit', icon: SquarePen, run: () => onEdit(msg) });
                        }
                    }
                    break;
                case 'img':
                    if (hasMsgFile(msg)) {
                        items.push({ id: 'copy', title: 'Copy', icon: Copy, run: () => copyMessageImage(msg, peerChatPK, readMessageFile) });
                        items.push({
                            id: 'save',
                            title: 'Save image',
                            icon: Download,
                            run: async () => {
                                await saveMessageImage(msg, peerChatPK, readMessageFile);
                                Alert.alert('Saved', 'Image saved to Photos.');
                            },
                        });
                    }
                    break;
                case 'file':
                case 'mp3':
                case 'mp4':
                    if (hasMsgFile(msg)) {
                        items.push({ id: 'save', title: 'Save file', icon: Download, run: () => saveMessageFile(msg, peerChatPK, readMessageFile) });
                    }
                    break;
                case 'req':
                    if (typeof onRequestHold === 'function') {
                        items.push({ id: 'transactions', title: 'Transactions', icon: History, run: onRequestHold });
                    }
                    break;
                default:
                    if (hasMsgText(msg)) {
                        items.push({ id: 'copy', title: 'Copy', icon: Copy, run: () => copyMessageText(msg) });
                    }
                    break;
            }

            if (canShare) {
                items.push({ id: 'share', title: 'Share', icon: Share2, run: () => openShareRoute(msg) });
            }

            if (isFailedSelf) {
                items.push({ id: 'retry', title: 'Retry', icon: RotateCcw, run: () => retryMessage(chatId, msg.cid) });
            }

            if (canReport) {
                items.push({
                    id: 'report',
                    title: 'Report',
                    icon: Flag,
                    run: () => {
                        Alert.alert('Report message?', 'We will manually review this report and will have access to the content you are reporting.', [
                            { text: 'cancel', style: 'cancel' },
                            { text: 'add note', onPress: () => promptReportNote('Report message', (value) => handleReportMessage(msg, value)) },
                            {
                                text: 'report',
                                style: 'destructive',
                                onPress: () => handleReportMessage(msg),
                            },
                        ]);
                    },
                });
            }

            if (canDelete) {
                items.push({
                    id: 'delete',
                    title: 'Delete',
                    icon: Trash2,
                    destructive: true,
                    run: () => handleDeleteMessage(msg),
                });
            }

            return items.length ? items : null;
        },
        [chatId, chatPK, handleDeleteMessage, handleReportMessage, onEdit, onReply, onRequestHold, openShareRoute, peerChatPK, peerUid, promptReportNote, readMessageFile, retryMessage, savingForeverMessages, toggleSaveForeverMessage]
    );

    const handlePay = useCallback(
        async (msg) => {
            if (!chatId || !peerChatPK || !peerWalletPK) return;
            setPayingMessages((prev) => new Set(prev).add(msg.id));
            try {
                const txId = await sendMoneyWithSpark(peerWalletPK, Number(msg.a));
                const nextMsg = { ...setReqTx(msg, txId), cid: msg.cid };
                patchMessage(msg.id, nextMsg);
                try {
                    await updateMessage(chatId, msg.id, nextMsg, peerChatPK);
                } catch (error) {
                    Alert.alert('Payment sent', 'The payment went through, but the chat confirmation has not synced yet.');
                    console.warn('Payment sent but failed to sync request confirmation:', error);
                }
            } catch (error) {
                Alert.alert('Send failed', error?.message || 'Failed to send payment.');
            } finally {
                setPayingMessages((prev) => {
                    const next = new Set(prev);
                    next.delete(msg.id);
                    return next;
                });
            }
        },
        [chatId, patchMessage, peerChatPK, peerWalletPK, sendMoneyWithSpark, updateMessage]
    );

    const canLikeMessage = useCallback(
        (msg) => {
            return !!(chatId && chatPK && peerChatPK && msg?.id && !String(msg.id).startsWith('local:') && !msg.pending && !msg.failed);
        },
        [chatId, chatPK, peerChatPK]
    );

    const handleLike = useCallback(
        (msg) => {
            if (!canLikeMessage(msg)) {
                return;
            }

            toggleOptimisticReaction(msg);
        },
        [canLikeMessage, toggleOptimisticReaction]
    );

    const renderItem = useCallback(
        ({ item: row }) => {
            const msg = row?.msg;
            const rowState = row?.state || 'present';
            if (isSystemMsg(msg)) {
                return <SystemMessageRow chatPad={chatPad} msg={msg} rowState={rowState} screenW={screenW} theme={theme} />;
            }

            const fromPeer = isPeerMsg(msg, chatPK);
            const userSent = !fromPeer;
            const msgKey = getMsgKey(msg);
            const isReported = !!msgKey && reportedMessageKeys.has(msgKey);
            const savingForever = !!msgKey && savingForeverMessages.has(msgKey);
            const saveForeverTargetSaved = savingForever ? savingForeverMessages.get(msgKey) === true : null;
            const savedForever = isSavedForeverMsg(msg);
            const dotSavedForever = savedForever || saveForeverTargetSaved === true;
            const showMsgDot = (userSent && (msg.pending || msg.failed)) || dotSavedForever;
            const msgDotExitToken = userSent && !showMsgDot ? row?.dotExitToken : 0;
            const menuItems = isReported || rowState === 'leaving' ? null : getMenuItems(msg);
            const reply = msg?.r ? replyMap.get(msg.r) || null : null;
            const replyFromPeer = reply ? isPeerMsg(reply, chatPK) : false;
            const viewerMedia = isMediaViewerMsg(msg);
            const canLike = !isReported && canLikeMessage(msg);
            const reactions = isReported ? [] : getOptimisticReactions(msg);
            const reactionBottomInset = reactions.length ? REACTION_SPACE : 0;
            const currentReceipt = userSent && msgKey && msgKey === latestReadReceiptKey ? latestReceiptMeta : null;
            const frozenReceipt = rowState === 'leaving' && msgKey ? receiptSnapshotRef.current.get(msgKey) || (msgKey === latestReadReceiptKey ? latestReceiptMeta : null) : null;
            const receipt = frozenReceipt || currentReceipt;
            const showReceipt = !!receipt;
            const receiptFrozen = rowState === 'leaving' && showReceipt;

            return (
                <MessageRow
                    chatPad={chatPad}
                    msg={msg}
                    rowState={rowState}
                    fromPeer={fromPeer}
                    theme={theme}
                    screenW={screenW}
                    timeGesture={timeGesture}
                    receiptStamp={receipt?.stamp || ''}
                    stampBottomInset={reactionBottomInset + (showReceipt ? RECEIPT_MARK_RESERVE : 0)}
                    onReply={canReplyToMsg(msg) ? onReply : undefined}
                    onLike={canLike && !viewerMedia ? handleLike : undefined}
                >
                    {({ onExitTargetLayout }) => (
                        <View style={{ maxWidth: (screenW - chatPad * 2) * 0.85, alignItems: userSent ? 'flex-end' : 'flex-start' }}>
                            <View collapsable={false} onLayout={onExitTargetLayout} style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {fromPeer ? <MsgDot show={showMsgDot} failed={msg.failed} saved={dotSavedForever} side="left" bottomInset={reactionBottomInset} theme={theme} /> : null}
                                {isReported ? (
                                    <ReportedBubble fromPeer={fromPeer} />
                                ) : (
                                    <View>
                                        <ChatMessageType
                                            msg={msg}
                                            fromPeer={fromPeer}
                                            menuId={msgKey}
                                            menuItems={menuItems}
                                            onRequestHold={onRequestHold}
                                            peerDisplayName={chatTitle}
                                            onPay={() => handlePay(msg)}
                                            isPaying={payingMessages.has(msg.id)}
                                            peerChatPK={peerChatPK}
                                            reply={reply}
                                            replyFromPeer={replyFromPeer}
                                            onReplyPress={() => jumpToReply(msg.r)}
                                            onLike={canLike ? handleLike : undefined}
                                            reactions={reactions}
                                            reactionUsers={reactionUsers}
                                            reactionPreviewInset={reactions.length ? LIKE_PREVIEW_INSET : 0}
                                        />
                                    </View>
                                )}
                                {!fromPeer ? <MsgDot show={showMsgDot} failed={msg.failed} saved={dotSavedForever} side="right" bottomInset={reactionBottomInset} exitToken={msgDotExitToken} theme={theme} /> : null}
                            </View>
                            <ReceiptMark show={showReceipt} source={receipt?.source ?? peerAvatarSource} bot={receipt?.bot ?? peerBot} frozen={receiptFrozen} />
                        </View>
                    )}
                </MessageRow>
            );
        },
        [
            canLikeMessage,
            chatPK,
            chatPad,
            chatTitle,
            getMenuItems,
            handleLike,
            handlePay,
            jumpToReply,
            latestReadReceiptKey,
            latestReceiptMeta,
            onReply,
            onRequestHold,
            payingMessages,
            peerChatPK,
            peerAvatarSource,
            peerBot,
            reactionUsers,
            replyMap,
            reportedMessageKeys,
            savingForeverMessages,
            screenW,
            theme,
            timeGesture,
        ]
    );

    return (
        <View style={{ flex: 1 }}>
            <GestureDetector gesture={timeGesture}>
                <Animated.View style={{ flex: 1, width: screenW, overflow: 'hidden' }}>
                    <Animated.View style={[{ flex: 1, width: screenW + STAMP_TRAY }, timeStyle]}>
                        <View style={{ flex: 1, width: screenW + STAMP_TRAY }}>
                            <Animated.FlatList
                                ref={(node) => {
                                    listRef.current = node;
                                }}
                                data={displayRows}
                                keyExtractor={(row) => row.key}
                                renderItem={renderItem}
                                itemLayoutAnimation={rowLayoutAnimation}
                                style={{ flex: 1, width: screenW + STAMP_TRAY, zIndex: 0 }}
                                inverted
                                renderScrollComponent={renderScrollComponent}
                                contentContainerStyle={{
                                    paddingTop: positivePx(insets.bottom + inputH + NEWEST_MESSAGE_GAP),
                                    paddingBottom: insets.top + 42 + 24,
                                }}
                                ListHeaderComponent={<Animated.View pointerEvents="none" style={composerReserveStyle} />}
                                automaticallyAdjustKeyboardInsets={false}
                                contentInsetAdjustmentBehavior="never"
                                keyboardDismissMode={KEYBOARD_DISMISS_MODE}
                                keyboardShouldPersistTaps="handled"
                                initialNumToRender={10}
                                maxToRenderPerBatch={6}
                                windowSize={5}
                                removeClippedSubviews={false}
                                scrollEnabled={!menuActive}
                                onScroll={handleListScroll}
                                scrollEventThrottle={16}
                                directionalLockEnabled
                                bounces
                                alwaysBounceVertical
                                alwaysBounceHorizontal={false}
                                onEndReached={handleLoadOlder}
                                onEndReachedThreshold={0.35}
                                onScrollToIndexFailed={({ index }) => {
                                    setTimeout(() => {
                                        listRef.current?.scrollToIndex?.({
                                            index,
                                            animated: true,
                                            viewPosition: 0.5,
                                        });
                                    }, 120);
                                }}
                            />
                            {!ready && !messagesAsc.length ? (
                                <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: STAMP_TRAY, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }}>
                                    <ActivityIndicator size="small" color={theme.muted} />
                                </View>
                            ) : null}
                        </View>
                    </Animated.View>
                </Animated.View>
            </GestureDetector>
            {children}
            {showScrollBottom || scrollBottomMounted ? (
                <KeyboardStickyView
                    offset={stickyOffset}
                    style={[
                        {
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            zIndex: 4,
                            alignItems: 'flex-end',
                            paddingRight: 16,
                        },
                        scrollBottomPositionStyle,
                    ]}
                    pointerEvents="box-none"
                >
                    <Animated.View pointerEvents={showScrollBottom ? 'auto' : 'none'} style={scrollBottomStyle}>
                        <GlassIcon glassEffectStyle="regular" icon={ArrowDown} onPress={scrollToBottom} />
                    </Animated.View>
                </KeyboardStickyView>
            ) : null}
        </View>
    );
}
