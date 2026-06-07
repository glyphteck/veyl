import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useChat } from '@/components/providers/chatprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { canShareAttachmentMsg, canToggleSaveForeverMsg, isSavedForeverMsg, setReqTx } from '@veyl/shared/chat/messages';
import { useOptimisticMessageReactions } from '@veyl/shared/chat/usereactions';
import { messageKeys } from '@veyl/shared/chat/messagekeys';
import { getMessageKey } from '@veyl/shared/chat/state';
import { canDownloadMsgFile, downloadMsgFile } from '@/lib/chat/messages';
import { EMPTY_KEY_SET } from './rows';
import { MESSAGE_ROW_LEAVE_MS } from '../rowmotion';

const LIKE_TAP_MS = 320;
const LIKE_TAP_DIST = 42;

function isInteractiveTarget(target) {
    return !!target?.closest?.('button,a,input,textarea,select,video,audio,[role="button"]');
}

export function useActions({ chatPK, messages, patchMessage, peerChatPK, peerProfile, removeMessage, selectedChatId }) {
    const { updateMessage, deleteMessage, retryMessage, makeMessagePermanent, makeMessageTemporary, readMessageFile, sendReaction } = useChat();
    const { sendMoneyWithSpark } = useWallet();
    const { openDialog } = useDialog();
    const [payingMessages, setPayingMessages] = useState(new Set());
    const [downloadingMessages, setDownloadingMessages] = useState(new Set());
    const [savingForeverMessages, setSavingForeverMessages] = useState(new Map());
    const [reportedMessageKeys, setReportedMessageKeys] = useState(new Set());
    const [deletingMessageKeys, setDeletingMessageKeys] = useState(EMPTY_KEY_SET);
    const deleteCleanupTimersRef = useRef(new Map());
    const lastLikeTapRef = useRef(null);
    const { getReactions: getOptimisticReactions, toggleReaction: toggleOptimisticReaction } = useOptimisticMessageReactions({
        chatId: selectedChatId,
        chatPK,
        peerChatPK,
        messages,
        sendReaction,
        onError: (error) => console.error('message like failed', error),
    });

    useEffect(() => {
        setReportedMessageKeys(new Set());
        setDeletingMessageKeys(EMPTY_KEY_SET);
        for (const timeout of deleteCleanupTimersRef.current.values()) {
            clearTimeout(timeout);
        }
        deleteCleanupTimersRef.current.clear();
    }, [selectedChatId]);

    useEffect(
        () => () => {
            for (const timeout of deleteCleanupTimersRef.current.values()) {
                clearTimeout(timeout);
            }
            deleteCleanupTimersRef.current.clear();
        },
        []
    );

    useEffect(() => {
        setSavingForeverMessages((prev) => {
            if (!prev.size) {
                return prev;
            }

            const byKey = new Map();
            for (const message of messages || []) {
                for (const key of messageKeys(message)) {
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
    }, [messages]);

    const canLikeMessage = useCallback(
        (msg) => {
            return !!(selectedChatId && chatPK && peerChatPK && msg?.id && !String(msg.id).startsWith('local:') && !msg.pending && !msg.failed);
        },
        [chatPK, peerChatPK, selectedChatId]
    );

    const canToggleSaveForeverMessage = useCallback(
        (msg) => {
            return !!selectedChatId && canToggleSaveForeverMsg(msg);
        },
        [selectedChatId]
    );

    const downloadMessage = useCallback(
        async (msg) => {
            if (!canDownloadMsgFile(msg, peerChatPK)) {
                return;
            }

            const key = getMessageKey(msg);
            if (key) {
                setDownloadingMessages((prev) => new Set(prev).add(key));
            }

            try {
                await downloadMsgFile(readMessageFile, peerChatPK, msg);
            } catch (error) {
                console.warn('chat media download failed', error);
                toast('download failed', {
                    description: error?.message || 'Could not download this message.',
                });
            } finally {
                if (key) {
                    setDownloadingMessages((prev) => {
                        const next = new Set(prev);
                        next.delete(key);
                        return next;
                    });
                }
            }
        },
        [peerChatPK, readMessageFile]
    );

    const toggleSaveForeverMessage = useCallback(
        async (msg) => {
            if (!canToggleSaveForeverMessage(msg)) {
                return;
            }

            const key = getMessageKey(msg);
            const saved = isSavedForeverMsg(msg);
            const targetSaved = !saved;

            if (key) {
                setSavingForeverMessages((prev) => new Map(prev).set(key, targetSaved));
            }

            try {
                if (saved) {
                    await makeMessageTemporary(selectedChatId, msg);
                } else {
                    await makeMessagePermanent(selectedChatId, msg);
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
        [canToggleSaveForeverMessage, makeMessagePermanent, makeMessageTemporary, selectedChatId]
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

            const key = getMessageKey(msg);
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
        const key = getMessageKey(msg);
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
        const keys = messageKeys(msg);
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
            return next.size ? next : EMPTY_KEY_SET;
        });
    }, []);

    const startDeletingMessage = useCallback((msg) => {
        const keys = messageKeys(msg);
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

    const dropDeletedMessage = useCallback(
        (id, msg) => {
            const keys = messageKeys(msg);
            const timeout = setTimeout(() => {
                removeMessage(msg);
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
                await deleteMessage(selectedChatId, msg);
                dropDeletedMessage(msg.id, msg);
            } catch (error) {
                clearDeletingMessage(msg);
                console.error('delete message failed', error);
                toast('delete failed', {
                    description: error?.message || 'Could not delete this message.',
                });
            }
        },
        [clearDeletingMessage, deleteMessage, dropDeletedMessage, selectedChatId, startDeletingMessage]
    );

    const openShareDialog = useCallback(
        (msg) => {
            if (!canShareAttachmentMsg(msg)) {
                return;
            }
            openDialog('sharemedia', { msg, sourcePeerChatPK: peerChatPK });
        },
        [openDialog, peerChatPK]
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

    return {
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
    };
}
