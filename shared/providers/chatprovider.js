'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getChatId } from '../crypto/chat.js';
import {
    getAttachmentType,
    makeChatUnavailableError,
} from '../chat/attachments.js';
import { useChatDelete } from '../chat/delete.js';
import { useChatReact } from '../chat/react.js';
import { clearReadWrites } from '../chat/read.js';
import { useChatSave } from '../chat/save.js';
import { useChatSeen } from '../chat/seen.js';
import { useChatSend } from '../chat/send.js';
import { useChatSettings } from '../chat/usesettings.js';
import { useChatWarming } from '../chat/warming.js';
import { useChatList } from '../chat/usechatlist.js';
import {
    deleteMsg as deleteMessageShared,
    getChatRow as getChatRowShared,
    listenToLatestMsgs as listenToLatestMessagesShared,
    makeMsgPermanent as makeMessagePermanentShared,
    makeMsgTemporary as makeMessageTemporaryShared,
    listenToChats as listenToChatsShared,
    loadMoreChats as loadMoreChatsShared,
    readMsgMedia as readMessageFileShared,
    sendReadReceipt as sendReadReceiptShared,
    sendReaction as sendReactionShared,
    sendMsg as sendMessageShared,
    setChatRetention as setChatRetentionShared,
    uploadAttachmentMsg as uploadAttachmentShared,
    uploadImgMsg as uploadImageShared,
    updateMsg as updateMessageShared,
    MSG_BATCH_SIZE,
} from '../chat/utils.js';
import { sortMessages } from '../chat/state.js';

export const DEFAULT_READ_RECEIPT_WRITE_DELAY_MS = 1200;
export const DEFAULT_MSG_BATCH_SIZE = MSG_BATCH_SIZE;

export function createChat({ db, storage, getStorage, uploadAttachment: uploadAttachmentImpl, uploadImage: uploadImageImpl, readMessageFile: readMessageFileImpl, setMediaSaved: setMediaSavedImpl, finishDeletingChat: finishDeletingChatImpl }) {
    if (!db) {
        throw new Error('createChat requires db');
    }

    function resolveStorage() {
        return typeof getStorage === 'function' ? getStorage() : storage;
    }

    return {
        sendMessage(senderPubkey, senderPrivkey, receiverChatPK, message, options) {
            return sendMessageShared(db, senderPubkey, senderPrivkey, receiverChatPK, message, options);
        },
        sendReadReceipt(senderPubkey, senderPrivkey, receiverChatPK, target, options) {
            return sendReadReceiptShared(db, senderPubkey, senderPrivkey, receiverChatPK, target, options);
        },
        sendReaction(senderPubkey, senderPrivkey, receiverChatPK, target, emoji, options) {
            return sendReactionShared(db, senderPubkey, senderPrivkey, receiverChatPK, target, emoji, options);
        },
        setChatTtl(chatId, senderPubkey, senderPrivkey, peerChatPK, retention) {
            return setChatRetentionShared(db, chatId, senderPubkey, senderPrivkey, peerChatPK, retention);
        },
        makeMessagePermanent(chatId, messages) {
            return makeMessagePermanentShared(db, chatId, messages);
        },
        makeMessageTemporary(chatId, messages, ttlMs) {
            return makeMessageTemporaryShared(db, chatId, messages, ttlMs);
        },
        setMediaSaved(path, stayId, saved) {
            if (typeof setMediaSavedImpl === 'function') {
                return setMediaSavedImpl(path, stayId, saved);
            }
            return Promise.resolve(false);
        },
        finishDeletingChat(chatId) {
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

            return uploadAttachmentShared(db, resolveStorage(), senderPubkey, senderPrivkey, receiverChatPK, attachment);
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
            return uploadImageShared(db, resolveStorage(), senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta);
        },
        updateMessage(chatId, msgId, senderPrivkey, receiverChatPK, newMessage, options) {
            return updateMessageShared(db, chatId, msgId, senderPrivkey, receiverChatPK, newMessage, options);
        },
        deleteMessage(chatId, msgId) {
            return deleteMessageShared(db, chatId, msgId);
        },
        readMessageFile(userChatPK, userPrivKey, peerChatPK, message) {
            if (typeof readMessageFileImpl === 'function') {
                return readMessageFileImpl(resolveStorage(), userChatPK, userPrivKey, peerChatPK, message);
            }
            return readMessageFileShared(resolveStorage(), userChatPK, userPrivKey, peerChatPK, message);
        },
        listenToChats(userChatPK, userPrivKey, onUpdate, onError, options) {
            return listenToChatsShared(db, userChatPK, userPrivKey, onUpdate, onError, options);
        },
        loadMoreChats(userChatPK, userPrivKey, cursor, pageSize) {
            return loadMoreChatsShared(db, userChatPK, userPrivKey, cursor, pageSize);
        },
        getChatRow(chatId, userChatPK, userPrivKey) {
            return getChatRowShared(db, chatId, userChatPK, userPrivKey);
        },
        listenToLatestMessages(chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError) {
            return listenToLatestMessagesShared(db, chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError);
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
        const { chatPK, chatBanned } = useUser();

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
            dropChat,
            wasChatDeletedLocally,
            ackDeletedChat,
            isChatPendingDelete,
        } = useChatDelete({
            chat,
            chatPK,
            localCache,
            setSelectedChat,
            setLocalByChat,
            localByChatRef,
            lastServerChatsRef,
            hiddenChatPreviewKeysRef,
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

        const handleExpiredChatPreview = useCallback((chatId, keys) => {
            chatListCallbacksRef.current.clearChatPreviewKeys?.(chatId, keys);
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
            warm: warmChats,
        } = useChatWarming({
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
            readCacheRef.current = new Map();
            localByChatRef.current = new Map();

            clearReadWrites(pendingReadRef.current);
            pendingReadRef.current = new Map();
        }, [clearMessageBatches, resetDeleteState, setSelectedChat]);

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
            chatBanned,
            chatPK,
            chatPrivateKey,
            sendOptionsForPeer,
        });

        const { setChatTtl } = useChatSettings({
            chat,
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
                return chat.updateMessage(chatId, msgId, chatPrivateKey, peerChatPK, newMessage, options);
            },
            [chat, chatBanned, chatPrivateKey]
        );
        const deleteMessage = useCallback(
            (chatId, msgId) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                return chat.deleteMessage(chatId, msgId);
            },
            [chat, chatBanned]
        );
        const {
            makeMessagePermanent,
            makeMessageTemporary,
            readMessageFile,
            readMessagePreview,
            writeMessagePreview,
        } = useChatSave({
            chat,
            chatBanned,
            chatPK,
            chatPrivateKey,
            localCache,
        });
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
                dropChat,
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
                setChatTtl,
                makeMessagePermanent,
                makeMessageTemporary,
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
                getChatRowLastMsgKey,
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
                dropChat,
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
                setChatTtl,
                makeMessagePermanent,
                makeMessageTemporary,
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
                getChatRowLastMsgKey,
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
