'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { deleteDoc, doc } from 'firebase/firestore';
import { CHAT_READ_RECEIPT_WRITE_DELAY_MS } from '../config.js';
import { getChatPeerPK, getPeerChatPKFromChatId } from '../chat/ids.js';
import {
    getAttachmentType,
    makeChatUnavailableError,
} from '../chat/attachments.js';
import { useChatDelete } from '../chat/actions/delete.js';
import { useChatReact } from '../chat/actions/react.js';
import { clearReadWrites } from '../chat/read.js';
import { useChatSave } from '../chat/actions/save.js';
import { collectSavedMediaStaysForChat, collectSavedMediaStaysForUser, deleteSavedMessageKey, deleteSavedMessageRecord, listenSavedMessageRecords, saveMessageRecord } from '../chat/saved.js';
import { useChatSeen } from '../chat/actions/seen.js';
import { useChatSend } from '../chat/actions/send.js';
import { useChatSettings } from '../chat/actions/settings.js';
import { useChatMessageSessions } from '../chat/messages/session/index.js';
import { useChatList } from '../chat/usechatlist.js';
import { resolveChatId as resolveChatIdShared } from '../chat/pairs.js';
import { ownChatEntryId } from '../chat/entries.js';
import { savedMediaStayRef } from '../chat/messages.js';
import {
    collectSavedMediaStays as collectSavedMediaStaysShared,
    listenToLatestMsgs as listenToLatestMessagesShared,
    MSG_BATCH_SIZE,
} from '../chat/messages/query.js';
import {
    getChatRow as getChatRowShared,
    listenToChats as listenToChatsShared,
    loadMoreChats as loadMoreChatsShared,
} from '../chat/rows.js';
import {
    deleteMsg as deleteMessageShared,
    deleteMsgs as deleteMessagesShared,
    makeMsgPermanent as makeMessagePermanentShared,
    makeMsgTemporary as makeMessageTemporaryShared,
    readMsgMedia as readMessageFileShared,
    sendReadReceipt as sendReadReceiptShared,
    sendHiddenCheckpoint as sendHiddenCheckpointShared,
    sendReaction as sendReactionShared,
    sendMsg as sendMessageShared,
    syncChatLastMsg as syncChatLastMsgShared,
    setChatRetention as setChatRetentionShared,
    uploadAttachmentMsg as uploadAttachmentShared,
    uploadImgMsg as uploadImageShared,
    updateMsg as updateMessageShared,
} from '../chat/messages/write.js';
import { sortMessages } from '../chat/state.js';

export const DEFAULT_READ_RECEIPT_WRITE_DELAY_MS = CHAT_READ_RECEIPT_WRITE_DELAY_MS;
export const DEFAULT_MSG_BATCH_SIZE = MSG_BATCH_SIZE;

function getMessageDeleteId(messageOrId) {
    if (typeof messageOrId === 'string') {
        return messageOrId;
    }
    return typeof messageOrId?.id === 'string' ? messageOrId.id : '';
}

function resolveDeleteMessage(localByChat, chatId, messageOrId) {
    if (messageOrId && typeof messageOrId === 'object') {
        return messageOrId;
    }

    const id = getMessageDeleteId(messageOrId);
    if (!id) {
        return null;
    }
    return (localByChat?.get?.(chatId) || []).find((message) => message?.id === id || message?.cid === id) ?? null;
}

function hasSavedMediaStay(message) {
    return !!savedMediaStayRef(message);
}

export function createChat({
    db,
    storage,
    getStorage,
    uploadAttachment: uploadAttachmentImpl,
    uploadImage: uploadImageImpl,
    readMessageFile: readMessageFileImpl,
    reserveChatMediaUpload: reserveChatMediaUploadImpl,
    setMediaSaved: setMediaSavedImpl,
    finishDeletingChat: finishDeletingChatImpl,
}) {
    if (!db) {
        throw new Error('createChat requires db');
    }

    function resolveStorage() {
        return typeof getStorage === 'function' ? getStorage() : storage;
    }

    function withMediaReservation(attachment = {}) {
        if (typeof reserveChatMediaUploadImpl !== 'function') {
            return attachment;
        }
        return {
            ...attachment,
            meta: {
                ...(attachment?.meta || {}),
                reserveChatMediaUpload: reserveChatMediaUploadImpl,
            },
        };
    }

    return {
        sendMessage(senderPubkey, senderPrivkey, receiverChatPK, message, options) {
            return sendMessageShared(db, senderPubkey, senderPrivkey, receiverChatPK, message, options);
        },
        resolveChatId(senderPubkey, senderPrivkey, receiverChatPK) {
            return resolveChatIdShared(senderPubkey, senderPrivkey, receiverChatPK);
        },
        syncChatLastMsg(chatId, lastMsg) {
            return syncChatLastMsgShared(db, chatId, lastMsg);
        },
        sendReadReceipt(senderPubkey, senderPrivkey, receiverChatPK, target, options) {
            return sendReadReceiptShared(db, senderPubkey, senderPrivkey, receiverChatPK, target, options);
        },
        sendReaction(senderPubkey, senderPrivkey, receiverChatPK, target, emoji, options) {
            return sendReactionShared(db, senderPubkey, senderPrivkey, receiverChatPK, target, emoji, options);
        },
        sendHiddenCheckpoint(senderPubkey, senderPrivkey, receiverChatPK, target, options) {
            return sendHiddenCheckpointShared(db, senderPubkey, senderPrivkey, receiverChatPK, target, options);
        },
        setChatTtl(chatId, senderPubkey, senderPrivkey, peerChatPK, retention, options) {
            return setChatRetentionShared(db, chatId, senderPubkey, senderPrivkey, peerChatPK, retention, options);
        },
        makeMessagePermanent(chatId, messages) {
            return makeMessagePermanentShared(db, chatId, messages);
        },
        makeMessageTemporary(chatId, messages, ttlMs) {
            return makeMessageTemporaryShared(db, chatId, messages, ttlMs);
        },
        setMediaSaved(path, stayId, stayKey, saved) {
            if (typeof setMediaSavedImpl === 'function') {
                return setMediaSavedImpl(path, stayId, stayKey, saved);
            }
            return Promise.resolve(false);
        },
        saveMessage(uid, chatPrivKey, chatId, message) {
            return saveMessageRecord(db, uid, chatPrivKey, chatId, message);
        },
        unsaveMessage(uid, chatPrivKey, chatId, message) {
            return deleteSavedMessageRecord(db, uid, chatPrivKey, chatId, message);
        },
        unsaveMessageKey(uid, chatPrivKey, chatId, messageKey) {
            return deleteSavedMessageKey(db, uid, chatPrivKey, chatId, messageKey);
        },
        listenSavedMessages(uid, chatPrivKey, chatId, onUpdate, onError) {
            return listenSavedMessageRecords(db, uid, chatPrivKey, chatId, onUpdate, onError);
        },
        collectSavedMediaStays(chatId, senderPubkey, senderPrivkey, peerChatPK) {
            return collectSavedMediaStaysShared(db, chatId, senderPubkey, senderPrivkey, peerChatPK);
        },
        collectOwnerSavedMediaStays(uid, chatPrivKey, chatId) {
            return collectSavedMediaStaysForChat(db, uid, chatPrivKey, chatId);
        },
        collectAccountSavedMediaStays(uid, chatPrivKey) {
            return collectSavedMediaStaysForUser(db, uid, chatPrivKey);
        },
        async finishDeletingChat(chatId, uid, chatPrivKey) {
            if (uid && chatPrivKey && chatId) {
                await deleteDoc(doc(db, 'users', uid, 'chats', ownChatEntryId(chatPrivKey, chatId))).catch(() => {});
            }
            if (typeof finishDeletingChatImpl === 'function') {
                return finishDeletingChatImpl(chatId);
            }
            return Promise.resolve(false);
        },
        uploadAttachment(senderPubkey, senderPrivkey, receiverChatPK, attachment = {}) {
            if (typeof uploadAttachmentImpl === 'function') {
                return uploadAttachmentImpl(senderPubkey, senderPrivkey, receiverChatPK, attachment);
            }

            if (getAttachmentType(attachment) === 'img' && typeof uploadImageImpl === 'function') {
                return uploadImageImpl(senderPubkey, senderPrivkey, receiverChatPK, attachment?.cid, attachment?.data, attachment?.meta);
            }

            return uploadAttachmentShared(db, resolveStorage(), senderPubkey, senderPrivkey, receiverChatPK, withMediaReservation(attachment));
        },
        uploadImage(senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta) {
            if (typeof uploadImageImpl === 'function') {
                return uploadImageImpl(senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta);
            }
            if (typeof uploadAttachmentImpl === 'function') {
                return uploadAttachmentImpl(senderPubkey, senderPrivkey, receiverChatPK, {
                    cid,
                    type: 'img',
                    data,
                    meta,
                });
            }
            return uploadImageShared(db, resolveStorage(), senderPubkey, senderPrivkey, receiverChatPK, cid, data, {
                ...(meta || {}),
                ...(typeof reserveChatMediaUploadImpl === 'function' ? { reserveChatMediaUpload: reserveChatMediaUploadImpl } : {}),
            });
        },
        updateMessage(chatId, msgId, senderPubkey, senderPrivkey, receiverChatPK, newMessage, options) {
            return updateMessageShared(db, chatId, msgId, senderPubkey, senderPrivkey, receiverChatPK, newMessage, options);
        },
        deleteMessage(chatId, msgId, senderPubkey, senderPrivkey, peerChatPK, options) {
            return deleteMessageShared(db, chatId, msgId, senderPubkey, senderPrivkey, peerChatPK, options);
        },
        deleteMessages(chatId, messages, senderPubkey, senderPrivkey, peerChatPK, options) {
            return deleteMessagesShared(db, chatId, messages, senderPubkey, senderPrivkey, peerChatPK, options);
        },
        readMessageFile(userChatPK, userPrivKey, peerChatPK, message) {
            if (typeof readMessageFileImpl === 'function') {
                return readMessageFileImpl(resolveStorage(), userChatPK, userPrivKey, peerChatPK, message);
            }
            return readMessageFileShared(resolveStorage(), userChatPK, userPrivKey, peerChatPK, message);
        },
        listenToChats(uid, userChatPK, userPrivKey, onUpdate, onError, options) {
            return listenToChatsShared(db, uid, userChatPK, userPrivKey, onUpdate, onError, options);
        },
        loadMoreChats(uid, userChatPK, userPrivKey, cursor, pageSize) {
            return loadMoreChatsShared(db, uid, userChatPK, userPrivKey, cursor, pageSize);
        },
        getChatRow(uid, chatId, userChatPK, userPrivKey) {
            return getChatRowShared(db, uid, chatId, userChatPK, userPrivKey);
        },
        listenToLatestMessages(chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError, options) {
            return listenToLatestMessagesShared(db, chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError, options);
        },
    };
}

export function createChatProvider({ chat, useUser, useVault, readReceiptWriteDelay = DEFAULT_READ_RECEIPT_WRITE_DELAY_MS, appState, chatWarming = false, preloadMessageMedia, adoptLocalMessageMedia, diag = null }) {
    if (!chat) {
        throw new Error('createChatProvider requires chat');
    }
    if (typeof useUser !== 'function' || typeof useVault !== 'function') {
        throw new Error('createChatProvider requires { useUser, useVault }');
    }

    const ChatContext = createContext(null);

    function ChatProvider({ children }) {
        const { chatPrivateKey, localCache } = useVault();
        const { uid, chatPK, chatBanned } = useUser();

        const [selectedChatId, setSelectedChatId] = useState(null);
        const [localByChat, setLocalByChat] = useState(new Map());
        const [isActive, setIsActive] = useState(() => !appState?.currentState || appState.currentState === 'active');

        const selectedChatIdRef = useRef(null);
        const lastServerChatsRef = useRef([]);
        const serverChatIdsRef = useRef([]);
        const serverChatsReadyRef = useRef(false);
        const chatPageCursorRef = useRef(null);
        const chatPageLockedRef = useRef(false);
        const chatHasMoreRef = useRef(false);
        const chatLoadingMoreRef = useRef(false);
        const chatRowLoadsRef = useRef(new Set());
        const readCacheRef = useRef(new Map());
        const pendingReadRef = useRef(new Map());
        const localByChatRef = useRef(new Map());
        const hiddenChatPreviewKeysRef = useRef(new Map());
        const chatPreviewOverridesRef = useRef(new Map());
        const lastHydratedCacheKeyRef = useRef('');
        const chatsRef = useRef([]);
        const resetSendingRef = useRef(null);
        const deleteListActionsRef = useRef(null);
        const closeMessageBatchRef = useRef(null);
        const chatListCallbacksRef = useRef({
            applyBatchReadReceipt: null,
            clearChatPreviewKeys: null,
        });

        const setSelectedChat = useCallback((next) => {
            if (typeof next !== 'function') {
                selectedChatIdRef.current = next ?? null;
            }
            setSelectedChatId((current) => {
                const value = typeof next === 'function' ? next(current) : next;
                selectedChatIdRef.current = value ?? null;
                return value;
            });
        }, []);

        useEffect(() => {
            selectedChatIdRef.current = selectedChatId ?? null;
        }, [selectedChatId]);

        useEffect(() => {
            localByChatRef.current = localByChat;
        }, [localByChat]);

        const {
            pendingDeleteIdsRef,
            keepSelectedDeletedChatIdsRef,
            deletingChatIdsRef,
            resetDeleteState,
            releaseChatWriteWait,
            releaseReadyChatWriteWaits,
            waitForPeerDelete,
            syncLiveDeleting,
            mergeDeletingIds,
            clearDeletedChatState,
            startDeleteChat,
            restoreDeletedChat,
            finishDeleteChat,
            deleteChat,
            dropChat,
            wasChatDeletedLocally,
            ackDeletedChat,
            isChatPendingDelete,
        } = useChatDelete({
            chat,
            uid,
            chatPK,
            chatPrivateKey,
            localCache,
            setSelectedChat,
            setLocalByChat,
            localByChatRef,
            lastServerChatsRef,
            hiddenChatPreviewKeysRef,
            chatPreviewOverridesRef,
            readCacheRef,
            pendingReadRef,
            listActionsRef: deleteListActionsRef,
            closeMessageBatchRef,
        });

        useEffect(() => {
            if (!appState?.addEventListener) {
                return;
            }

            const sub = appState.addEventListener('change', (nextState) => {
                setIsActive(nextState === 'active');
            });
            return () => sub?.remove?.();
        }, [appState]);

        const handleBatchReadReceipt = useCallback((chatId, messages) => {
            chatListCallbacksRef.current.applyBatchReadReceipt?.(chatId, messages);
        }, []);

        const handleExpiredChatPreview = useCallback((chatId, keys, replacement = null) => {
            chatListCallbacksRef.current.clearChatPreviewKeys?.(chatId, keys, replacement);
        }, []);

        const {
            clear: clearMessageBatches,
            closeBatch: closeMessageBatch,
            ensureMessageBatch,
            getMessageBatch,
            expireMessageBatch,
            releaseMessageBatch,
            subscribeMessageBatch,
            queueMessagePreload,
            getMessageView,
            rememberMessageView,
            updateMessageView,
            retainMessageView,
            releaseMessageView,
            warm: warmChats,
        } = useChatMessageSessions({
            chat,
            chatPK,
            chatPrivateKey,
            chatBanned,
            isActive,
            localCache,
            rowsRef: lastServerChatsRef,
            pendingDeleteIdsRef,
            config: chatWarming,
            preloadMessageMedia,
            diag,
            onRead: handleBatchReadReceipt,
            onExpire: handleExpiredChatPreview,
        });
        closeMessageBatchRef.current = closeMessageBatch;

        const resetExternalChatState = useCallback(() => {
            clearMessageBatches();
            resetSendingRef.current?.();
            setSelectedChat((prev) => (prev != null ? null : prev));
            setLocalByChat((prev) => (prev.size ? new Map() : prev));
            resetDeleteState();
            hiddenChatPreviewKeysRef.current = new Map();
            chatPreviewOverridesRef.current = new Map();
            readCacheRef.current = new Map();
            localByChatRef.current = new Map();

            clearReadWrites(pendingReadRef.current);
            pendingReadRef.current = new Map();
        }, [clearMessageBatches, resetDeleteState, setSelectedChat]);

        const getPeerChatPKForChatId = useCallback(
            (chatId) => {
                if (!chatId) {
                    return null;
                }
                const row = chatsRef.current.find((chatItem) => chatItem?.id === chatId) || lastServerChatsRef.current.find((chatItem) => chatItem?.id === chatId);
                return getChatPeerPK(row, chatPK) || getPeerChatPKFromChatId(chatId, chatPK);
            },
            [chatPK, lastServerChatsRef]
        );

        const {
            chats,
            setChats,
            peers,
            isChatDataReady,
            hasChats,
            lastChat,
            setLastChat,
            hasMoreChats,
            loadingMoreChats,
            loadMoreChats,
            commitServerChats,
            updateRenderedChats,
            clearChatPreviewKeys,
            applyBatchReadReceipt,
            resetChatList,
            ensureChatRow,
            getChatRowLastMsgKey,
            getChatRetention,
            sendOptionsForPeer,
            hasChatDoc,
        } = useChatList({
            chat,
            uid,
            chatPK,
            chatPrivateKey,
            chatBanned,
            localCache,
            isActive,
            diag,
            selectedChatId,
            selectedChatIdRef,
            setSelectedChat,
            localByChatRef,
            pendingDeleteIdsRef,
            keepSelectedDeletedChatIdsRef,
            deletingChatIdsRef,
            chatPreviewOverridesRef,
            syncLiveDeleting,
            mergeDeletingIds,
            clearDeletedChatState,
            hiddenChatPreviewKeysRef,
            readCacheRef,
            lastServerChatsRef,
            serverChatIdsRef,
            serverChatsReadyRef,
            chatPageCursorRef,
            chatPageLockedRef,
            chatHasMoreRef,
            chatLoadingMoreRef,
            chatRowLoadsRef,
            lastHydratedCacheKeyRef,
            chatsRef,
            warmChats,
            resetExternalChatState,
        });

        deleteListActionsRef.current = {
            setChats,
            setLastChat,
            commitServerChats,
        };

        useEffect(() => {
            chatListCallbacksRef.current = {
                applyBatchReadReceipt,
                clearChatPreviewKeys,
            };
        }, [applyBatchReadReceipt, clearChatPreviewKeys]);

        const cleanupChats = useCallback(
            (ready = false) => {
                resetExternalChatState();
                resetChatList(ready);
            },
            [resetChatList, resetExternalChatState]
        );

        useEffect(() => () => cleanupChats(), [cleanupChats]);

        const { markChatReadReceipt, markChatRead } = useChatSeen({
            chat,
            uid,
            chatBanned,
            chatPK,
            chatPrivateKey,
            localCache,
            pendingReadRef,
            readCacheRef,
            readReceiptWriteDelay,
            getChatRetention,
            setChats,
        });

        const selectChat = useCallback(
            (chatId) => {
                if (chatBanned) {
                    return;
                }
                void ensureChatRow(chatId);
                ensureMessageBatch(chatId, {
                    source: 'route',
                    rowLastMsgKey: getChatRowLastMsgKey(chatId),
                });
                setSelectedChat(chatId);
            },
            [chatBanned, ensureChatRow, ensureMessageBatch, getChatRowLastMsgKey, setSelectedChat]
        );

        const resolvePeerChatId = useCallback(
            (peerChatPK) => {
                if (chatBanned || !chatPK || !chatPrivateKey || !peerChatPK || typeof chat.resolveChatId !== 'function') {
                    return Promise.resolve(null);
                }
                return chat.resolveChatId(chatPK, chatPrivateKey, peerChatPK);
            },
            [chat, chatBanned, chatPK, chatPrivateKey]
        );

        const selectPeerChat = useCallback(
            async (peerChatPK) => {
                const chatId = await resolvePeerChatId(peerChatPK);
                if (chatId) {
                    ensureMessageBatch(chatId, { source: 'route', peerChatPK });
                    setSelectedChat(chatId);
                }
                return chatId;
            },
            [ensureMessageBatch, resolvePeerChatId, setSelectedChat]
        );

        const {
            resetSending,
            ackMessages,
            adoptConfirmedMessages,
            sendMessage,
            retryMessage,
            sendAttachment,
            sendImage,
            sendAttachmentMany,
            sendImageMany,
            shareAttachment,
        } = useChatSend({
            chat,
            uid,
            chatBanned,
            chatPK,
            chatPrivateKey,
            localCache,
            localByChatRef,
            setLocalByChat,
            setChats,
            setLastChat,
            waitForPeerDelete,
            sendOptionsForPeer,
            adoptLocalMessageMedia,
        });
        resetSendingRef.current = resetSending;

        const { sendReaction } = useChatReact({
            chat,
            uid,
            chatBanned,
            chatPK,
            chatPrivateKey,
            sendOptionsForPeer,
        });

        const { setChatTtl } = useChatSettings({
            chat,
            uid,
            chatBanned,
            chatPK,
            chatPrivateKey,
            localCache,
            lastServerChatsRef,
            pendingDeleteIdsRef,
            chatsRef,
            setChats,
        });

        const updateMessage = useCallback(
            (chatId, msgId, newMessage, peerChatPK, options) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                return chat.updateMessage(chatId, msgId, chatPK, chatPrivateKey, peerChatPK, newMessage, { ...(options || {}), senderUid: uid });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, uid]
        );
        const {
            makeMessagePermanent,
            makeMessageTemporary,
            readMessageFile,
            readMessagePreview,
            writeMessagePreview,
        } = useChatSave({
            chat,
            uid,
            chatBanned,
            chatPK,
            chatPrivateKey,
            localCache,
        });
        const listenSavedMessages = useCallback(
            (chatId, onUpdate, onError) => {
                if (!uid || !chatPrivateKey || typeof chat.listenSavedMessages !== 'function') {
                    onUpdate?.([]);
                    return () => {};
                }
                return chat.listenSavedMessages(uid, chatPrivateKey, chatId, onUpdate, onError);
            },
            [chat, uid, chatPrivateKey]
        );
        const unsaveMessageKey = useCallback(
            (chatId, messageKey) => {
                if (!uid || !chatPrivateKey || typeof chat.unsaveMessageKey !== 'function') {
                    return Promise.resolve(false);
                }
                return chat.unsaveMessageKey(uid, chatPrivateKey, chatId, messageKey);
            },
            [chat, uid, chatPrivateKey]
        );
        const deleteMessage = useCallback(
            async (chatId, messageOrId) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }

                const msgId = getMessageDeleteId(messageOrId);
                if (!msgId) {
                    return false;
                }

                const message = resolveDeleteMessage(localByChatRef.current, chatId, messageOrId);
                if (hasSavedMediaStay(message)) {
                    await makeMessageTemporary(chatId, message);
                }

                const peerChatPK = getPeerChatPKForChatId(chatId);
                return chat.deleteMessage(chatId, msgId, chatPK, chatPrivateKey, peerChatPK, { target: message?.cid || msgId, senderUid: uid });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, getPeerChatPKForChatId, localByChatRef, makeMessageTemporary, uid]
        );
        const deleteMessages = useCallback(
            async (chatId, messages) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                return chat.deleteMessages(chatId, messages, chatPK, chatPrivateKey, getPeerChatPKForChatId(chatId), { senderUid: uid });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, getPeerChatPKForChatId, uid]
        );
        const collectAccountSavedMediaStays = useCallback(() => {
            if (!uid || !chatPrivateKey || typeof chat.collectAccountSavedMediaStays !== 'function') {
                return Promise.resolve([]);
            }
            return chat.collectAccountSavedMediaStays(uid, chatPrivateKey).catch(() => []);
        }, [chat, uid, chatPrivateKey]);
        const releaseSavedMediaStays = useCallback(
            (stays) => {
                if (!Array.isArray(stays) || !stays.length || typeof chat.setMediaSaved !== 'function') {
                    return Promise.resolve([]);
                }
                return Promise.allSettled(stays.map((stay) => chat.setMediaSaved(stay.path, stay.stayId, stay.stayKey, false)));
            },
            [chat]
        );
        const markMessagesHidden = useCallback(
            (chatId, target) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const peerChatPK = getPeerChatPKForChatId(chatId);
                if (!chatPK || !chatPrivateKey || !peerChatPK || !target) {
                    throw makeChatUnavailableError();
                }
                return chat.sendHiddenCheckpoint(chatPK, chatPrivateKey, peerChatPK, target, sendOptionsForPeer(peerChatPK));
            },
            [chat, chatBanned, chatPK, chatPrivateKey, getPeerChatPKForChatId, sendOptionsForPeer]
        );
        const getMessages = useCallback((chatId) => (isChatPendingDelete(chatId) ? [] : sortMessages(localByChat.get(chatId) ?? [])), [isChatPendingDelete, localByChat]);

        const value = useMemo(
            () => ({
                chats,
                peers,
                chatBanned,
                isChatDataReady,
                hasChats,
                hasMoreChats,
                loadingMoreChats,
                loadMoreChats,
                selectedChatId,
                selectChat,
                resolvePeerChatId,
                selectPeerChat,
                dropChat,
                deleteChat,
                startDeleteChat,
                finishDeleteChat,
                restoreDeletedChat,
                markChatReadReceipt,
                markChatRead,
                hasChatDoc,
                getMessages,
                wasChatDeletedLocally,
                ackDeletedChat,
                sendMessage,
                retryMessage,
                sendAttachment,
                sendImage,
                sendAttachmentMany,
                sendImageMany,
                shareAttachment,
                updateMessage,
                sendReaction,
                deleteMessage,
                deleteMessages,
                collectAccountSavedMediaStays,
                releaseSavedMediaStays,
                markMessagesHidden,
                setChatTtl,
                makeMessagePermanent,
                makeMessageTemporary,
                listenSavedMessages,
                unsaveMessageKey,
                readMessageFile,
                readMessagePreview,
                writeMessagePreview,
                adoptConfirmedMessages,
                ackMessages,
                lastChat,
                ensureMessageBatch,
                expireMessageBatch,
                releaseMessageBatch,
                subscribeMessageBatch,
                queueMessagePreload,
                getMessageBatch,
                getMessageView,
                rememberMessageView,
                updateMessageView,
                retainMessageView,
                releaseMessageView,
                getChatRowLastMsgKey,
                syncChatPreviewDrop: clearChatPreviewKeys,
            }),
            [
                chats,
                peers,
                chatBanned,
                isChatDataReady,
                hasChats,
                hasMoreChats,
                loadingMoreChats,
                loadMoreChats,
                selectedChatId,
                selectChat,
                resolvePeerChatId,
                selectPeerChat,
                dropChat,
                deleteChat,
                startDeleteChat,
                finishDeleteChat,
                restoreDeletedChat,
                markChatReadReceipt,
                markChatRead,
                hasChatDoc,
                getMessages,
                wasChatDeletedLocally,
                ackDeletedChat,
                sendMessage,
                retryMessage,
                sendAttachment,
                sendImage,
                sendAttachmentMany,
                sendImageMany,
                shareAttachment,
                updateMessage,
                sendReaction,
                deleteMessage,
                deleteMessages,
                collectAccountSavedMediaStays,
                releaseSavedMediaStays,
                markMessagesHidden,
                setChatTtl,
                makeMessagePermanent,
                makeMessageTemporary,
                listenSavedMessages,
                unsaveMessageKey,
                readMessageFile,
                readMessagePreview,
                writeMessagePreview,
                adoptConfirmedMessages,
                ackMessages,
                lastChat,
                ensureMessageBatch,
                expireMessageBatch,
                releaseMessageBatch,
                subscribeMessageBatch,
                queueMessagePreload,
                getMessageBatch,
                getMessageView,
                rememberMessageView,
                updateMessageView,
                retainMessageView,
                releaseMessageView,
                getChatRowLastMsgKey,
                clearChatPreviewKeys,
            ]
        );

        return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
    }

    function useChat() {
        const context = useContext(ChatContext);
        if (!context) {
            throw new Error('useChat must be used within a ChatProvider');
        }
        return context;
    }

    return { ChatProvider, useChat, ChatContext };
}
