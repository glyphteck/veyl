import { ActivityIndicator, Alert, Text, View, useWindowDimensions } from 'react-native';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { httpsCallable } from 'firebase/functions';
import { Copy, Download, Flag, History, Reply, RotateCcw, Share2, SquarePen, Trash2 } from 'lucide-react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useChat } from '@/providers/chatprovider';
import { useTheme } from '@/providers/themeprovider';
import { useMenu } from '@/providers/menuprovider';
import { useMediaViewer } from '@/providers/mediaviewerprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import GlassView from '@/components/glass/glassview';
import Avatar, { StaticAvatar } from '@/components/avatar';
import { ChatMessageType, TextBubble } from '@/components/chat/messages';
import { REACTION_SPACE } from '@/components/chat/messages/reactiontray';
import { MessageGestureProvider } from '@/components/chat/messagegesturecontext';
import Icon from '@/components/icon';
import { KeyboardGestureArea, KeyboardListScrollView } from '@/components/keyboardscroll';
import { useChatMessages } from '@/lib/usechatmessages';
import { uploadStorageBytesNative } from '@/lib/chatmedia';
import { getMediaViewerKey, isMediaViewerMsg } from '@/lib/chatmediaitems';
import { copyMessageImage, copyMessageText, saveMessageFile, saveMessageImage } from '@/lib/chatdownloads';
import { stageShareMedia } from '@/lib/sharemedia';
import { functions, storage } from '@/lib/firebase';
import { canReplyToMsg, canShareAttachmentMsg, canShowMsg, getLatestReadOutgoingReceipt, isPeerMsg, setReqTx } from '@glyphteck/shared/chat/messages';
import { useOptimisticMessageReactions } from '@glyphteck/shared/chat/usereactions';
import { makeFileId, reportEvidencePath } from '@glyphteck/shared/files';
import { buildReportFields, getReportAttachmentMeta } from '@glyphteck/shared/report';
import { formatTimeHHMM } from '@glyphteck/shared/utils';
import { getMessageOrderMs } from '@glyphteck/shared/chat/state';

const STAMP_W = 108;
const STAMP_WAIT = 12;
const STAMP_TRAY = STAMP_W + STAMP_WAIT;
const REPLY_DRAG = 24;
const REPLY_HINT_W = 44;
const REPLY_TRIGGER = 64;
const REPLY_ICON_DELAY = 24;
const NEWEST_MESSAGE_GAP = 8;
const MESSAGE_ROW_ANIMATION_MS = 160;
const MESSAGE_ROW_EASING = Easing.out(Easing.cubic);
const MESSAGE_ROW_LAYOUT = LinearTransition.duration(MESSAGE_ROW_ANIMATION_MS).easing(MESSAGE_ROW_EASING);
const MESSAGE_ROW_ENTERING = FadeIn.duration(MESSAGE_ROW_ANIMATION_MS).easing(MESSAGE_ROW_EASING);
const MESSAGE_ROW_EXITING = FadeOut.duration(MESSAGE_ROW_ANIMATION_MS).easing(MESSAGE_ROW_EASING);
const LIKE_PREVIEW_INSET = 22;
const LIKE_BLOCK_MS = 320;
const RECEIPT_MARK_SIZE = 16;
const RECEIPT_ANIMATION_MS = 160;
const RECEIPT_START_SCALE = 0.01;
const REPLY_SPRING = {
    mass: 0.16,
    stiffness: 200,
    damping: 4.5,
};
const SWIPE_KEYBOARD = true;
const KEYBOARD_DISMISS_MODE = SWIPE_KEYBOARD ? 'interactive' : 'none';
const KEYBOARD_INTERPOLATOR = 'ios';

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

function SendDot({ show, failed, theme }) {
    if (!show) {
        return null;
    }

    return (
        <View pointerEvents="none" style={{ width: 8, height: 8, marginLeft: 8, alignSelf: 'center' }}>
            <GlassView glassEffectStyle="regular" tintColor={failed ? theme.destructive : theme.active} style={{ width: 8, height: 8, borderRadius: 999 }} />
        </View>
    );
}

function ReceiptAvatar({ source, bot }) {
    if (!source) {
        return <Avatar pointerEvents="none" source={source} size={RECEIPT_MARK_SIZE} bot={!!bot} />;
    }

    return <StaticAvatar pointerEvents="none" source={source} size={RECEIPT_MARK_SIZE} />;
}

function ReceiptMark({ show, source, bot }) {
    const [present, setPresent] = useState(show);
    const prevShowRef = useRef(false);
    const opacity = useSharedValue(0);
    const scale = useSharedValue(RECEIPT_START_SCALE);
    const markStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }],
    }));

    useEffect(() => {
        if (!show) {
            prevShowRef.current = false;
            opacity.value = withTiming(0, { duration: RECEIPT_ANIMATION_MS });
            scale.value = withTiming(RECEIPT_START_SCALE, { duration: RECEIPT_ANIMATION_MS });
            const timeout = setTimeout(() => setPresent(false), RECEIPT_ANIMATION_MS);
            return () => clearTimeout(timeout);
        }

        setPresent(true);
        const wasShown = prevShowRef.current;
        prevShowRef.current = true;
        opacity.value = wasShown ? 1 : 0;
        scale.value = wasShown ? 1 : RECEIPT_START_SCALE;
        opacity.value = withTiming(1, { duration: RECEIPT_ANIMATION_MS });
        scale.value = withTiming(1, { duration: RECEIPT_ANIMATION_MS });
        return undefined;
    }, [opacity, scale, show]);

    if (!present && !show) return null;

    return (
        <Animated.View pointerEvents="none" style={[{ marginTop: 5, paddingRight: 4, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center' }, markStyle]}>
            <ReceiptAvatar source={source} bot={bot} />
        </Animated.View>
    );
}

function ReportedBubble({ fromPeer = false }) {
    return <TextBubble msg={{ c: 'reported message hidden' }} fromPeer={fromPeer} />;
}

const ChatScroll = forwardRef(function ChatScroll({ dismissMode, pad, ...props }, ref) {
    return <KeyboardListScrollView ref={ref} {...props} inverted bounces alwaysBounceVertical keyboardDismissMode={dismissMode} keyboardLiftBehavior="always" extraContentPadding={pad} />;
});

function MessageRow({ chatPad, msg, fromPeer = false, theme, nativeListGesture, timeGesture, screenW, receiptStamp, onReply, onLike, children }) {
    const reply = useSharedValue(0);
    const [swipeBlocked, setSwipeBlocked] = useState(false);
    const likeBlockedRef = useRef(false);
    const likeBlockTimerRef = useRef(null);
    const stamp = useMemo(() => getMsgStamp(msg), [msg?.cid, msg?.id, msg?.ts]);
    const canReply = typeof onReply === 'function';
    const canLike = typeof onLike === 'function';
    const hasPan = canReply;
    const replyIconLeft = fromPeer;
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

    const replyMoveStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: reply.value }],
    }));

    const replyStyle = useAnimatedStyle(() => {
        const reveal = clamp((Math.abs(reply.value) - REPLY_ICON_DELAY) / 42, 0, 1);
        return {
            opacity: reveal,
            transform: [{ scale: 0.84 + reveal * 0.24 }],
        };
    });

    const replyGesture = useMemo(
        () =>
            Gesture.Pan()
                .enabled(canReply && !swipeBlocked)
                .activeOffsetX(fromPeer ? 4 : -4)
                .failOffsetY([-10, 10])
                .failOffsetX(fromPeer ? -4 : 4)
                .blocksExternalGesture(nativeListGesture, ...(!fromPeer && timeGesture ? [timeGesture] : []))
                .onUpdate((event) => {
                    const drag = fromPeer ? Math.max(event.translationX, 0) : Math.max(-event.translationX, 0);
                    reply.value = fromPeer ? revealReply(drag) : -revealReply(drag);
                })
                .onEnd((event) => {
                    const drag = fromPeer ? event.translationX : -event.translationX;
                    if (drag >= REPLY_TRIGGER && canReply) {
                        scheduleOnRN(triggerReply);
                    }
                })
                .onFinalize(() => {
                    reply.value = withSpring(0, REPLY_SPRING);
                }),
        [canReply, fromPeer, nativeListGesture, reply, swipeBlocked, timeGesture, triggerReply]
    );

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
    const content = <MessageGestureProvider value={gestureValue}>{children}</MessageGestureProvider>;

    return (
        <Animated.View
            collapsable={false}
            layout={MESSAGE_ROW_LAYOUT}
            entering={MESSAGE_ROW_ENTERING}
            exiting={MESSAGE_ROW_EXITING}
            style={{ width: screenW + STAMP_TRAY, paddingTop: 4, paddingBottom: 18, overflow: 'hidden' }}
        >
            {stamp ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: screenW + STAMP_WAIT,
                        top: 0,
                        bottom: 0,
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
                        bottom: 15,
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
                    <GestureDetector gesture={rowGesture}>
                        <Animated.View collapsable={false} style={hasPan ? replyMoveStyle : undefined}>
                            {content}
                        </Animated.View>
                    </GestureDetector>
                ) : (
                    content
                )}
            </View>
        </Animated.View>
    );
}

export default function MessageList({
    chatId,
    chatPad = 16,
    chatTitle,
    children,
    inputH = 48,
    inputId,
    onRequestHold,
    pad,
    peerAvatarSource,
    peerBot = false,
    peerChatPK,
    peerUid,
    peerWalletPK,
    onReply,
    onEdit,
}) {
    const navigation = useNavigation();
    const router = useRouter();
    const { avatar, chatPK, uid } = useUser();
    const { theme } = useTheme();
    const { active: menuActive } = useMenu();
    const { setMediaItems } = useMediaViewer();
    const { updateMessage, deleteMessage, retryMessage, readMessageFile, sendReaction } = useChat();
    const { sendMoneyWithSpark } = useWallet();
    const insets = useSafeAreaInsets();
    const { width: screenW } = useWindowDimensions();
    const { messages: messagesAsc, ready, hasOlder, loadingOlder, loadOlder, patchMessage, removeMessage } = useChatMessages(chatId);
    const submitReport = useMemo(() => httpsCallable(functions, 'submitReport'), []);
    const [payingMessages, setPayingMessages] = useState(new Set());
    const [reportedMessageKeys, setReportedMessageKeys] = useState(new Set());
    const time = useSharedValue(0);
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
    const visibleMessagesAsc = useMemo(() => (messagesAsc || []).filter(canShowMsg), [messagesAsc]);
    const messages = useMemo(() => [...visibleMessagesAsc].reverse(), [visibleMessagesAsc]);
    const latestReadReceipt = useMemo(() => getLatestReadOutgoingReceipt(messagesAsc, chatPK, peerChatPK), [chatPK, messagesAsc, peerChatPK]);
    const latestReadReceiptKey = getMsgKey(latestReadReceipt?.message);
    const latestReadReceiptStamp = useMemo(() => getMsgStamp(latestReadReceipt?.receipt), [latestReadReceipt?.receipt?.cid, latestReadReceipt?.receipt?.id, latestReadReceipt?.receipt?.ts]);
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

    const scrollComp = useCallback((props) => <ChatScroll {...props} dismissMode={KEYBOARD_DISMISS_MODE} pad={pad} />, [pad]);

    const nativeListGesture = useMemo(() => Gesture.Native(), []);

    useEffect(() => {
        setMediaItems([]);
        loadingOlderRef.current = false;
    }, [chatId, setMediaItems]);

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

    const disableBackSwipe = useCallback(() => {
        navigation.setOptions({ gestureEnabled: false });
    }, [navigation]);

    const enableBackSwipe = useCallback(() => {
        navigation.setOptions({ gestureEnabled: true });
    }, [navigation]);

    const handleScrollEndDrag = useCallback(
        (event) => {
            const velocityY = event?.nativeEvent?.velocity?.y ?? 0;
            if (Math.abs(velocityY) < 0.1) {
                enableBackSwipe();
            } else {
                disableBackSwipe();
            }
        },
        [disableBackSwipe, enableBackSwipe]
    );

    const timeGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetX(-4)
                .failOffsetX(4)
                .failOffsetY([-10, 10])
                .blocksExternalGesture(nativeListGesture)
                .onUpdate((event) => {
                    time.value = Math.min(rubberBand(Math.max(-event.translationX, 0), STAMP_TRAY), STAMP_TRAY);
                })
                .onFinalize(() => {
                    time.value = withSpring(0, REPLY_SPRING);
                }),
        [nativeListGesture, time]
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
        (msg) => {
            if (!chatId || !msg?.id || String(msg.id).startsWith('local:')) {
                return;
            }

            Alert.alert('Delete message?', 'This removes it for both people in this chat.', [
                { text: 'cancel', style: 'cancel' },
                {
                    text: 'delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteMessage(chatId, msg.id);
                            removeMessage(msg.id);
                        } catch (error) {
                            console.warn('delete message failed', error);
                            Alert.alert('Delete failed', error?.message || 'Could not delete this message.');
                        }
                    },
                },
            ]);
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
            const index = messages.findIndex((msg) => msg?.id === key || msg?.cid === key);
            if (index === -1) {
                return;
            }
            listRef.current?.scrollToIndex?.({
                index,
                animated: true,
                viewPosition: 0.5,
            });
        },
        [messages, listRef]
    );

    const getMenuItems = useCallback(
        (msg) => {
            const fromPeer = isPeerMsg(msg, chatPK);
            const canReport = fromPeer && !!peerUid && msg?.t !== 'req';
            const isFailedSelf = !fromPeer && msg.failed;
            const canDelete = !!msg?.id && !String(msg.id).startsWith('local:');
            const canEdit = !fromPeer && msg?.t === 'txt' && hasMsgText(msg);
            const canReply = canReplyToMsg(msg);
            const canShare = canShareAttachmentMsg(msg);
            const items = [];

            if (canReply && typeof onReply === 'function') {
                items.push({ id: 'reply', title: 'Reply', icon: Reply, run: () => onReply(msg) });
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
        [chatId, chatPK, handleDeleteMessage, handleReportMessage, onEdit, onReply, onRequestHold, openShareRoute, peerChatPK, peerUid, promptReportNote, readMessageFile, retryMessage]
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
        ({ item: msg }) => {
            const fromPeer = isPeerMsg(msg, chatPK);
            const userSent = !fromPeer;
            const msgKey = getMsgKey(msg);
            const isReported = !!msgKey && reportedMessageKeys.has(msgKey);
            const menuItems = isReported ? null : getMenuItems(msg);
            const reply = msg?.r ? replyMap.get(msg.r) || null : null;
            const replyFromPeer = reply ? isPeerMsg(reply, chatPK) : false;
            const viewerMedia = isMediaViewerMsg(msg);
            const canLike = !isReported && canLikeMessage(msg);
            const reactions = isReported ? [] : getOptimisticReactions(msg);
            const showReceipt = userSent && msgKey && msgKey === latestReadReceiptKey;

            return (
                <MessageRow
                    chatPad={chatPad}
                    msg={msg}
                    fromPeer={fromPeer}
                    theme={theme}
                    screenW={screenW}
                    nativeListGesture={nativeListGesture}
                    timeGesture={timeGesture}
                    receiptStamp={showReceipt ? latestReadReceiptStamp : ''}
                    onReply={canReplyToMsg(msg) ? onReply : undefined}
                    onLike={canLike && !viewerMedia ? handleLike : undefined}
                >
                    <View style={{ maxWidth: (screenW - chatPad * 2) * 0.85, alignItems: userSent ? 'flex-end' : 'flex-start' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
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
                            <SendDot show={userSent && (msg.pending || msg.failed)} failed={msg.failed} theme={theme} />
                        </View>
                        <ReceiptMark show={showReceipt} source={peerAvatarSource} bot={peerBot} />
                    </View>
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
            latestReadReceiptStamp,
            nativeListGesture,
            onReply,
            onRequestHold,
            payingMessages,
            peerChatPK,
            peerAvatarSource,
            peerBot,
            reactionUsers,
            replyMap,
            reportedMessageKeys,
            screenW,
            theme,
            timeGesture,
        ]
    );

    return (
        <KeyboardGestureArea
            enableSwipeToDismiss={SWIPE_KEYBOARD}
            interpolator={KEYBOARD_INTERPOLATOR}
            offset={SWIPE_KEYBOARD ? positivePx(inputH) : 0}
            style={{ flex: 1 }}
            textInputNativeID={SWIPE_KEYBOARD ? inputId : undefined}
        >
            <GestureDetector gesture={timeGesture}>
                <Animated.View style={{ flex: 1, width: screenW, overflow: 'hidden' }}>
                    <Animated.View style={[{ flex: 1, width: screenW + STAMP_TRAY }, timeStyle]}>
                        <View style={{ flex: 1, width: screenW + STAMP_TRAY }}>
                            <GestureDetector gesture={nativeListGesture}>
                                <Animated.FlatList
                                    ref={(node) => {
                                        listRef.current = node;
                                    }}
                                    data={messages}
                                    keyExtractor={getMsgKey}
                                    renderItem={renderItem}
                                    renderScrollComponent={scrollComp}
                                    itemLayoutAnimation={MESSAGE_ROW_LAYOUT}
                                    style={{ flex: 1, width: screenW + STAMP_TRAY, zIndex: 0 }}
                                    inverted
                                    contentContainerStyle={{
                                        paddingTop: positivePx(insets.bottom + inputH + NEWEST_MESSAGE_GAP),
                                        paddingBottom: insets.top + 42 + 24,
                                    }}
                                    automaticallyAdjustKeyboardInsets={false}
                                    contentInsetAdjustmentBehavior="never"
                                    keyboardShouldPersistTaps="handled"
                                    initialNumToRender={10}
                                    maxToRenderPerBatch={6}
                                    windowSize={5}
                                    removeClippedSubviews={false}
                                    scrollEnabled={!menuActive}
                                    onScrollBeginDrag={disableBackSwipe}
                                    onScrollEndDrag={handleScrollEndDrag}
                                    onMomentumScrollBegin={disableBackSwipe}
                                    onMomentumScrollEnd={enableBackSwipe}
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
                            </GestureDetector>
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
        </KeyboardGestureArea>
    );
}
