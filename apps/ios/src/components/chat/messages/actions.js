import { Alert } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Bookmark, Copy, Download, Flag, History, Reply, RotateCcw, Share2, SquarePen, Trash2 } from 'lucide-react-native';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { copyMessageImage, copyMessageText, downloadMessageFile, downloadMessageImage } from '@/lib/chat/downloads';
import { stageShareMedia } from '@/lib/chat/share';
import { cloud } from '@/lib/cloud';
import { canReplyToMsg, canShareAttachmentMsg, canToggleSaveForeverMsg, isPeerMsg, isSavedForeverMsg, setReqTx } from '@veyl/shared/chat/messages';
import { useOptimisticMessageReactions } from '@veyl/shared/chat/usereactions';
import { makeFileId } from '@veyl/shared/files';
import { buildReportFields, getReportAttachmentMeta } from '@veyl/shared/report';
import { messageKeys } from '@veyl/shared/chat/messagekeys';
import { getMessageKey } from '@veyl/shared/chat/state';

function hasMessageText(msg) {
    return typeof msg?.c === 'string' && msg.c.trim().length > 0;
}

function hasMessageFile(msg) {
    return (typeof msg?.localUri === 'string' && msg.localUri.trim().length > 0) || (typeof msg?.p === 'string' && !!msg.p && typeof msg?.k === 'string' && !!msg.k);
}

export function useActions({
    chatId,
    chatPK,
    messages,
    onEdit,
    onReply,
    onRequestHold,
    patchMessage,
    peerChatPK,
    peerUid,
    peerWalletPK,
    removeMessage,
}) {
    const router = useRouter();
    const { uid } = useUser();
    const { updateMessage, deleteMessage, retryMessage, makeMessagePermanent, makeMessageTemporary, readMessageFile, sendReaction } = useChat();
    const { sendMoneyWithSpark } = useWallet();
    const [payingMessages, setPayingMessages] = useState(new Set());
    const [savingForeverMessages, setSavingForeverMessages] = useState(new Map());
    const [reportedMessageKeys, setReportedMessageKeys] = useState(new Set());
    const [deletingMessageKeys, setDeletingMessageKeys] = useState(new Set());
    const {
        getReactions: getOptimisticReactions,
        toggleReaction: toggleOptimisticReaction,
    } = useOptimisticMessageReactions({
        chatId,
        chatPK,
        peerChatPK,
        messages,
        sendReaction,
        onError: (error) => console.warn('message like failed', error),
    });

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

    const runReport = useCallback(async ({ uid: reportUid, type, content, path, note, onDone }) => {
        try {
            await cloud.reports.submit({
                uid: reportUid,
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
    }, []);

    const handleReportMessage = useCallback(
        async (msg, note) => {
            if (!peerUid) return;
            const report = buildReportFields({ msg, note });
            const attachment = getReportAttachmentMeta(msg);

            try {
                let path;

                if (attachment && uid && peerChatPK) {
                    const bytes = await readMessageFile(peerChatPK, msg);
                    path = await cloud.reports.evidence.upload(uid, peerUid, makeFileId(12), bytes, {
                        contentType: attachment.mimeType || 'application/octet-stream',
                        name: attachment.name,
                        kind: attachment.kind,
                    });
                }

                await runReport({
                    uid: peerUid,
                    ...report,
                    ...(path ? { path } : {}),
                    onDone: () => {
                        const key = getMessageKey(msg);
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

            const keys = messageKeys(msg);
            if (!keys.length) {
                return;
            }

            setDeletingMessageKeys((prev) => {
                if (keys.every((key) => prev.has(key))) {
                    return prev;
                }
                const next = new Set(prev);
                for (const key of keys) {
                    next.add(key);
                }
                return next;
            });

            try {
                await deleteMessage(chatId, msg);
                removeMessage(msg);
            } catch (error) {
                console.warn('delete message failed', error);
                setDeletingMessageKeys((prev) => {
                    if (!keys.some((key) => prev.has(key))) {
                        return prev;
                    }
                    const next = new Set(prev);
                    for (const key of keys) {
                        next.delete(key);
                    }
                    return next;
                });
                Alert.alert('Delete failed', error?.message || 'Could not delete this message.');
                return;
            }

            setDeletingMessageKeys((prev) => {
                if (!keys.some((key) => prev.has(key))) {
                    return prev;
                }
                const next = new Set(prev);
                for (const key of keys) {
                    next.delete(key);
                }
                return next;
            });
        },
        [chatId, deleteMessage, removeMessage]
    );

    const openShareRoute = useCallback(
        (msg) => {
            const params = stageShareMedia(msg, { sourcePeerChatPK: peerChatPK });
            if (!params) {
                return;
            }
            router.push({ pathname: '/sharemedia', params });
        },
        [peerChatPK, router]
    );

    const toggleSaveForeverMessage = useCallback(
        async (msg) => {
            if (!chatId || !canToggleSaveForeverMsg(msg)) {
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
                    await makeMessageTemporary?.(chatId, msg);
                } else {
                    await makeMessagePermanent?.(chatId, msg);
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
        [chatId, makeMessagePermanent, makeMessageTemporary]
    );

    const getMenuItems = useCallback(
        (msg) => {
            const fromPeer = isPeerMsg(msg, chatPK);
            const msgKey = getMessageKey(msg);
            const savingForever = !!msgKey && savingForeverMessages.has(msgKey);
            const savedForever = savingForever ? savingForeverMessages.get(msgKey) === true : isSavedForeverMsg(msg);
            const canReport = fromPeer && !!peerUid && msg?.t !== 'req';
            const isFailedSelf = !fromPeer && msg.failed;
            const canDelete = !!msg?.id && !String(msg.id).startsWith('local:');
            const canEdit = !fromPeer && msg?.t === 'txt' && hasMessageText(msg);
            const canReply = canReplyToMsg(msg);
            const canShare = canShareAttachmentMsg(msg);
            const canSaveForever = canToggleSaveForeverMsg(msg);
            const items = [];

            if (canReply && typeof onReply === 'function') {
                items.push({ id: 'reply', title: 'Reply', icon: Reply, run: () => onReply(msg) });
            }

            if (canSaveForever) {
                items.push({ id: 'save-forever', title: savedForever ? 'Unsave' : 'Save', icon: Bookmark, filled: savedForever, disabled: savingForever, run: () => toggleSaveForeverMessage(msg) });
            }

            switch (msg?.t) {
                case 'txt':
                    if (hasMessageText(msg)) {
                        items.push({ id: 'copy', title: 'Copy', icon: Copy, run: () => copyMessageText(msg) });
                        if (canEdit && typeof onEdit === 'function') {
                            items.push({ id: 'edit', title: 'Edit', icon: SquarePen, run: () => onEdit(msg) });
                        }
                    }
                    break;
                case 'img':
                    if (hasMessageFile(msg)) {
                        items.push({ id: 'copy', title: 'Copy', icon: Copy, run: () => copyMessageImage(msg, peerChatPK, readMessageFile) });
                        items.push({
                            id: 'download',
                            title: 'Download image',
                            icon: Download,
                            run: async () => {
                                await downloadMessageImage(msg, peerChatPK, readMessageFile);
                                Alert.alert('Downloaded', 'Image downloaded to Photos.');
                            },
                        });
                    }
                    break;
                case 'file':
                case 'mp3':
                case 'mp4':
                    if (hasMessageFile(msg)) {
                        items.push({ id: 'download', title: 'Download file', icon: Download, run: () => downloadMessageFile(msg, peerChatPK, readMessageFile) });
                    }
                    break;
                case 'req':
                    if (typeof onRequestHold === 'function') {
                        items.push({ id: 'transactions', title: 'Transactions', icon: History, run: onRequestHold });
                    }
                    break;
                default:
                    if (hasMessageText(msg)) {
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

    return {
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
    };
}
