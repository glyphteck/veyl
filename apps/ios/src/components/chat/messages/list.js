import { ActivityIndicator, View, useWindowDimensions } from 'react-native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ArrowDown } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '@/providers/themeprovider';
import { useMenu } from '@/providers/menuprovider';
import { useMediaViewer } from '@/providers/mediaviewerprovider';
import { useUser } from '@/providers/userprovider';
import GlassIcon from '@/components/glass/glassicon';
import { KeyboardChatScrollView, KeyboardStickyView } from '@/components/keyboardscroll';
import { ChatMessageType } from '@/components/chat/messages/type';
import ReceiptMark, { RECEIPT_MARK_RESERVE } from '@/components/chat/receiptmark';
import { REACTION_SPACE } from '@/components/chat/messages/reactiontray';
import Dot from './dot';
import { useActions } from './actions';
import { useAnimatedRows } from './rows';
import { useScroll } from './scroll';
import { Row, ReportedBubble, SystemRow } from './row';
import { MESSAGE_ROW_LAYOUT, REPLY_SPRING, STAMP_TRAY, rubberBand } from '@/components/chat/rowmotion';
import { mark } from '@/lib/diagnostics';
import { useChatMessages } from '@/lib/chat/usemessages';
import { getMediaViewerKey, isMediaViewerMsg } from '@/lib/chat/viewer';
import { cancelPendingMsgFileLoads } from '@/lib/chat/imagecache';
import { canReplyToMsg, canShowMsg, collapseSystemMessages, getLatestReadOutgoingReceipt, isPeerMsg, isSavedForeverMsg, isSystemMsg } from '@veyl/shared/chat/messages';
import { isDateSeparatorMsg, withDateSeparators } from '@veyl/shared/chat/messages/dates';
import { messageKeys } from '@veyl/shared/chat/messagekeys';
import { formatTimeHHMM } from '@veyl/shared/utils/time';
import { getMessageKey, getMessageOrderMs } from '@veyl/shared/chat/state';

const LIKE_PREVIEW_INSET = 22;
const KEYBOARD_DISMISS_MODE = 'interactive';

function hasMsgFile(msg) {
    return (typeof msg?.localUri === 'string' && msg.localUri.trim().length > 0) || (typeof msg?.p === 'string' && !!msg.p && typeof msg?.k === 'string' && !!msg.k);
}

function getMsgStamp(msg) {
    const ms = getMessageOrderMs(msg);
    return Number.isFinite(ms) && ms !== Infinity ? formatTimeHHMM(ms, true) : '';
}

export default function Messages({
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
    const { avatar, chatPK } = useUser();
    const { theme } = useTheme();
    const { active: menuActive } = useMenu();
    const { setMediaItems } = useMediaViewer();
    const { width: screenW } = useWindowDimensions();
    const { messages: messagesAsc, ready, hasOlder, loadingOlder, loadOlder, patchMessage, removeMessage } = useChatMessages(chatId);
    const time = useSharedValue(0);
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
        canLikeMessage,
        deletingMessageKeys,
        getMenuItems,
        getOptimisticReactions,
        handleLike,
        handlePay,
        payingMessages,
        readMessageFile,
        reportedMessageKeys,
        savingForeverMessages,
    } = useActions({
        chatId,
        chatPK,
        messages: messagesAsc,
        onEdit,
        onReply,
        onRequestHold,
        patchMessage,
        peerChatPK,
        peerUid,
        peerWalletPK,
        removeMessage,
    });
    const activeMessagesAsc = useMemo(
        () => (messagesAsc || []).filter((msg) => !messageKeys(msg).some((key) => deletingMessageKeys.has(key))),
        [deletingMessageKeys, messagesAsc]
    );
    const visibleMessagesAsc = useMemo(() => collapseSystemMessages(activeMessagesAsc.filter(canShowMsg)), [activeMessagesAsc]);
    const datedMessagesAsc = useMemo(() => withDateSeparators(visibleMessagesAsc), [visibleMessagesAsc]);
    const messages = useMemo(() => [...datedMessagesAsc].reverse(), [datedMessagesAsc]);
    const displayRows = useAnimatedRows(messages, chatId || '', ready);
    const rowLayoutAnimation = useMemo(() => (displayRows.some((row) => row?.state === 'entering') ? MESSAGE_ROW_LAYOUT : undefined), [displayRows]);
    const latestReadReceipt = useMemo(() => getLatestReadOutgoingReceipt(activeMessagesAsc, chatPK, peerChatPK), [activeMessagesAsc, chatPK, peerChatPK]);
    const latestReadReceiptKey = getMessageKey(latestReadReceipt?.message);
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

    const mediaItems = useMemo(
        () =>
            visibleMessagesAsc
                .filter((msg) => {
                    const key = getMessageKey(msg);
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
    const {
        bottomMounted: scrollBottomMounted,
        bottomPositionStyle: scrollBottomPositionStyle,
        bottomStyle: scrollBottomStyle,
        contentContainerStyle,
        handleListScroll,
        handleLoadOlder,
        listRef,
        scrollToBottom,
        showBottom: showScrollBottom,
        stickyOffset,
    } = useScroll({
        chatId,
        extraContentPadding,
        hasOlder,
        inputH,
        loadOlder,
        loadingOlder,
    });
    const renderScrollComponent = useCallback(
        (props) => (
            <KeyboardChatScrollView
                {...props}
                inverted
                keyboardDismissMode={KEYBOARD_DISMISS_MODE}
                keyboardLiftBehavior="persistent"
                extraContentPadding={extraContentPadding}
            />
        ),
        [extraContentPadding]
    );

    useEffect(() => {
        setMediaItems([]);
        mark('chat.list.mount', { chatId: chatId || '' });
        return () => {
            cancelPendingMsgFileLoads();
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

    useEffect(() => {
        setMediaItems(mediaItems);
    }, [mediaItems, setMediaItems]);

    useEffect(() => () => setMediaItems([]), [setMediaItems]);

    const timeStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: -time.value }],
    }));

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

    const renderItem = useCallback(
        ({ item: row }) => {
            const msg = row?.msg;
            const rowState = row?.state || 'present';
            if (isSystemMsg(msg) || isDateSeparatorMsg(msg)) {
                return <SystemRow chatPad={chatPad} msg={msg} rowState={rowState} screenW={screenW} theme={theme} />;
            }

            const fromPeer = isPeerMsg(msg, chatPK);
            const userSent = !fromPeer;
            const msgKey = getMessageKey(msg);
            const isReported = !!msgKey && reportedMessageKeys.has(msgKey);
            const savingForever = !!msgKey && savingForeverMessages.has(msgKey);
            const saveForeverTargetSaved = savingForever ? savingForeverMessages.get(msgKey) === true : null;
            const savedForever = isSavedForeverMsg(msg);
            const dotSavedForever = savedForever || saveForeverTargetSaved === true;
            const showDot = (userSent && (msg.pending || msg.failed)) || dotSavedForever;
            const dotExitToken = userSent && !showDot ? row?.dotExitToken : 0;
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
                <Row
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
                                {fromPeer ? <Dot show={showDot} failed={msg.failed} saved={dotSavedForever} side="left" bottomInset={reactionBottomInset} theme={theme} /> : null}
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
                                {!fromPeer ? <Dot show={showDot} failed={msg.failed} saved={dotSavedForever} side="right" bottomInset={reactionBottomInset} exitToken={dotExitToken} theme={theme} /> : null}
                            </View>
                            <ReceiptMark show={showReceipt} source={receipt?.source ?? peerAvatarSource} bot={receipt?.bot ?? peerBot} frozen={receiptFrozen} />
                        </View>
                    )}
                </Row>
            );
        },
        [
            canLikeMessage,
            chatPK,
            chatPad,
            chatTitle,
            getOptimisticReactions,
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
                                contentContainerStyle={contentContainerStyle}
                                renderScrollComponent={renderScrollComponent}
                                automaticallyAdjustKeyboardInsets={false}
                                contentInsetAdjustmentBehavior="never"
                                keyboardDismissMode={KEYBOARD_DISMISS_MODE}
                                keyboardShouldPersistTaps="handled"
                                extraData={getOptimisticReactions}
                                initialNumToRender={20}
                                maxToRenderPerBatch={10}
                                windowSize={3}
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
