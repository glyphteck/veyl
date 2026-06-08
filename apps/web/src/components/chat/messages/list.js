'use client';
import { ArrowDown, Loader } from 'lucide-react';
import { Button } from '@/components/button';
import { useChat } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { canShowMsg, collapseSystemMessages, getLatestReadOutgoingReceipt, isPeerMsg, isSavedForeverMsg } from '@veyl/shared/chat/messages';
import { withDateSeparators } from '@veyl/shared/chat/messages/dates';
import { formatUserDisplay } from '@veyl/shared/profile';
import { formatTimeHHMM } from '@veyl/shared/utils/time';
import { getMessageKey, getMessageOrderMs } from '@veyl/shared/chat/state';
import { useChatMessages } from '@/lib/chat/usemessages';
import { useRef, useEffect, useCallback, useMemo } from 'react';
import { MemoRow } from './row';
import { useActions } from './actions';
import { useAnimatedRows } from './rows';
import { useScroll } from './scroll';

const EMPTY_RECEIPT_PEER = Object.freeze({});

function formatMsgTime(msg) {
    const ms = getMessageOrderMs(msg);
    return Number.isFinite(ms) && ms !== Infinity ? formatTimeHHMM(ms, true) : '';
}

export function Messages({ onReply, onEdit, bottomPad = 96 }) {
    const { chats, selectedChatId } = useChat();
    const { avatar, chatPK } = useUser();
    const { peerByChatPK } = usePeer();
    const rowRefs = useRef(new Map());
    const receiptSnapshotRef = useRef(new Map());
    const receiptSnapshotChatRef = useRef('');
    if (receiptSnapshotChatRef.current !== (selectedChatId || '')) {
        receiptSnapshotChatRef.current = selectedChatId || '';
        receiptSnapshotRef.current.clear();
    }

    const { messages: msgs, ready, hasOlder, loadingOlder, loadOlder, patchMessage, removeMessage } = useChatMessages(selectedChatId);
    const currentChat = useMemo(() => chats?.find((chat) => chat?.id === selectedChatId) ?? null, [chats, selectedChatId]);
    const peerChatPK = currentChat?.peerChatPK || null;
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
    const {
        canToggleSaveForeverMessage,
        deleteSelectedMessage,
        deletingMessageKeys,
        downloadMessage,
        downloadingMessages,
        getOptimisticReactions,
        handleMessagePointerUp,
        handlePayment,
        openShareDialog,
        payingMessages,
        reportedMessageKeys,
        reportMessage,
        retrySentMessage,
        savingForeverMessages,
        toggleSaveForeverMessage,
    } = useActions({
        chatPK,
        messages: msgs,
        patchMessage,
        peerChatPK,
        peerProfile,
        removeMessage,
        selectedChatId,
    });
    const visibleMsgs = useMemo(() => collapseSystemMessages((msgs || []).filter(canShowMsg)), [msgs]);
    const datedMsgs = useMemo(() => withDateSeparators(visibleMsgs), [visibleMsgs]);
    const displayMsgs = useMemo(() => [...datedMsgs].reverse(), [datedMsgs]);
    const displayRows = useAnimatedRows(displayMsgs, selectedChatId || '', deletingMessageKeys, ready);
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

    const {
        handleListScroll,
        handleListTransitionEnd,
        loadMoreRef,
        scrollRef,
        scrollToBottom,
        showOlderLoader,
        showScrollBottom,
    } = useScroll({
        bottomPad,
        chatId: selectedChatId,
        displayCount: displayMsgs.length,
        hasOlder,
        loadingOlder,
        loadOlder,
        newestRowKey,
        ready,
    });

    const latestReadReceipt = useMemo(() => getLatestReadOutgoingReceipt(msgs, chatPK, peerChatPK), [chatPK, msgs, peerChatPK]);
    const latestReadReceiptKey = getMessageKey(latestReadReceipt?.message);
    const latestReadReceiptTime = useMemo(() => formatMsgTime(latestReadReceipt?.receipt), [latestReadReceipt?.receipt]);
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
                    const msgKey = getMessageKey(msg);
                    const isReported = !!msgKey && reportedMessageKeys.has(msgKey);
                    const downloading = !!msgKey && downloadingMessages.has(msgKey);
                    const savingForever = !!msgKey && savingForeverMessages.has(msgKey);
                    const saveForeverTargetSaved = savingForever ? savingForeverMessages.get(msgKey) === true : null;
                    const savedForever = isSavedForeverMsg(msg);
                    const reply = msg?.r ? replyMap.get(msg.r) || null : null;
                    const replyFromPeer = reply ? isPeerMsg(reply, chatPK) : false;
                    const currentReceipt = !suppressLiveReceipt && userSent && msgKey && msgKey === latestReadReceiptKey ? latestReceiptMeta : null;
                    const frozenReceipt = rowState === 'leaving' && msgKey ? receiptSnapshotRef.current.get(msgKey) || (msgKey === latestReadReceiptKey ? latestReceiptMeta : null) : null;
                    const receipt = frozenReceipt || currentReceipt;
                    return (
                        <MemoRow
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
                            isDownloading={downloading}
                            isSavedForever={savedForever}
                            saveForeverTargetSaved={saveForeverTargetSaved}
                            isSavingForever={savingForever}
                            isPaying={payingMessages.has(msg.id)}
                            canSaveForever={canToggleSaveForeverMessage(msg)}
                            rowRefs={rowRefs}
                            getOptimisticReactions={getOptimisticReactions}
                            onReply={onReply}
                            onEdit={onEdit}
                            onRetry={retrySentMessage}
                            onDownload={downloadMessage}
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
