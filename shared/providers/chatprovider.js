'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_READ_RECEIPT_WRITE_DELAY_MS } from '../config.js';
import { getChatPeerPK, getPeerChatPKFromChatId } from '../chat/ids.js';
import { makeChatUnavailableError } from '../chat/attachments.js';
import { useChatDelete } from '../chat/actions/delete.js';
import { useChatReact } from '../chat/actions/react.js';
import { clearReadWrites } from '../chat/read.js';
import { useChatSave } from '../chat/actions/save.js';
import { useChatSeen } from '../chat/actions/seen.js';
import { useChatSend } from '../chat/actions/send.js';
import { useChatSettings } from '../chat/actions/settings.js';
import { useChatMessageSessions } from '../chat/messages/session/index.js';
import { useChatList } from '../chat/usechatlist.js';
import { processInbox } from '../chat/inbox.js';
import {
    loadOlderMsgs as loadOlderMessagesShared,
    MSG_BATCH_SIZE,
} from '../chat/messages/query.js';
import { loadAllChats as loadAllChatEntries } from '../chat/list.js';
import {
    deleteMsg as deleteMessageShared,
    deleteMsgs as deleteMessagesShared,
    sendHiddenCheckpoint as sendHiddenCheckpointShared,
    updateMsg as updateMessageShared,
} from '../chat/messages/write.js';
import { sortMessages } from '../chat/state.js';

export const DEFAULT_READ_RECEIPT_WRITE_DELAY_MS = CHAT_READ_RECEIPT_WRITE_DELAY_MS;
export const DEFAULT_MSG_BATCH_SIZE = MSG_BATCH_SIZE;
const DELETE_ALL_CHATS_BATCH_SIZE = 400;

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

export function createChatProvider({ cloud, media = {}, useUser, useVault, readReceiptWriteDelay = DEFAULT_READ_RECEIPT_WRITE_DELAY_MS, appState, chatWarming = false, preloadMessageMedia, adoptLocalMessageMedia, diag = null }) {
    if (!cloud) {
        throw new Error('createChatProvider requires cloud');
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
        const chatLoadsRef = useRef(new Set());
        const readCacheRef = useRef(new Map());
        const pendingReadRef = useRef(new Map());
        const localByChatRef = useRef(new Map());
        const pendingPeerSelectRef = useRef('');
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

        const getPeerChatPKForChatId = useCallback(
            (chatId, peerChatPK = '') => {
                if (peerChatPK) {
                    return peerChatPK;
                }
                if (!chatId) {
                    return null;
                }
                const chatItem = chatsRef.current.find((item) => item?.id === chatId) || lastServerChatsRef.current.find((item) => item?.id === chatId);
                return getChatPeerPK(chatItem, chatPK) || getPeerChatPKFromChatId(chatId, chatPK);
            },
            [chatPK]
        );

        const deleteMessage = useCallback(
            async (chatId, messageOrId, peerChatPK = '') => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }

                const msgId = getMessageDeleteId(messageOrId);
                if (!msgId) {
                    return false;
                }

                const message = resolveDeleteMessage(localByChatRef.current, chatId, messageOrId);
                return deleteMessageShared(cloud, chatId, message || msgId, chatPK, chatPrivateKey, getPeerChatPKForChatId(chatId, peerChatPK), { docId: msgId });
            },
            [cloud, chatBanned, chatPK, chatPrivateKey, getPeerChatPKForChatId, localByChatRef]
        );

        const deleteMessages = useCallback(
            async (chatId, messages, peerChatPK = '') => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                return deleteMessagesShared(cloud, chatId, messages, chatPK, chatPrivateKey, getPeerChatPKForChatId(chatId, peerChatPK));
            },
            [cloud, chatBanned, chatPK, chatPrivateKey, getPeerChatPKForChatId]
        );

        const markMessagesHidden = useCallback(
            (chatId, target, peerChatPK = '') => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const targetPeerChatPK = getPeerChatPKForChatId(chatId, peerChatPK);
                if (!chatPK || !chatPrivateKey || !targetPeerChatPK || !target) {
                    throw makeChatUnavailableError();
                }
                return sendHiddenCheckpointShared(cloud, chatPK, chatPrivateKey, targetPeerChatPK, target, { chatId });
            },
            [cloud, chatBanned, chatPK, chatPrivateKey, getPeerChatPKForChatId]
        );

        const {
            pendingDeleteIdsRef,
            keepSelectedDeletedChatIdsRef,
            resetDeleteState,
            waitForPeerDelete,
            clearDeletedChatState,
            restoreDeletedChat,
            deleteChat,
            dropChat,
            dropUnavailableChat,
            wasChatDeletedLocally,
            ackDeletedChat,
            isChatPendingDelete,
        } = useChatDelete({
            cloud,
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
            cloud,
            media,
            chatPK,
            chatPrivateKey,
            chatBanned,
            isActive,
            localCache,
            listRef: lastServerChatsRef,
            pendingDeleteIdsRef,
            config: chatWarming,
            preloadMessageMedia,
            deleteMessages,
            markMessagesHidden,
            diag,
            onRead: handleBatchReadReceipt,
            onExpire: handleExpiredChatPreview,
            onUnavailable: dropUnavailableChat,
        });

        const loadOlderMessages = useCallback(
            (chatId, userChatPK, userPrivKey, peerChatPK, before, requestedPageSize, options) => loadOlderMessagesShared(cloud, chatId, userChatPK, userPrivKey, peerChatPK, before, requestedPageSize, options),
            [cloud]
        );
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
            ensureChat,
            getChatLastMsgKey,
            getChatRetention,
            sendOptionsForPeer,
            hasChat,
        } = useChatList({
            cloud,
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
            chatPreviewOverridesRef,
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
            chatLoadsRef,
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
            cloud,
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
                void ensureChat(chatId);
                ensureMessageBatch(chatId, {
                    source: 'route',
                    chatLastMsgKey: getChatLastMsgKey(chatId),
                });
                setSelectedChat(chatId);
            },
            [chatBanned, ensureChat, ensureMessageBatch, getChatLastMsgKey, setSelectedChat]
        );

        const resolvePeerChatId = useCallback(
            async (peerChatPK) => {
                if (chatBanned || !peerChatPK) {
                    return null;
                }
                return sendOptionsForPeer(peerChatPK)?.chatId || null;
            },
            [chatBanned, sendOptionsForPeer]
        );

        const selectPeerChat = useCallback(
            async (peerChatPK) => {
                const chatId = await resolvePeerChatId(peerChatPK);
                if (chatId) {
                    pendingPeerSelectRef.current = '';
                    ensureMessageBatch(chatId, { source: 'route', peerChatPK });
                    setSelectedChat(chatId);
                } else {
                    pendingPeerSelectRef.current = peerChatPK || '';
                }
                return chatId;
            },
            [ensureMessageBatch, resolvePeerChatId, setSelectedChat]
        );

        const selectLocalChat = useCallback(
            (peerChatPK, chatId) => {
                if (!chatId) {
                    return;
                }
                if (pendingPeerSelectRef.current && pendingPeerSelectRef.current === peerChatPK) {
                    pendingPeerSelectRef.current = '';
                    setSelectedChat(chatId);
                } else if (!selectedChatIdRef.current) {
                    setSelectedChat(chatId);
                }
            },
            [setSelectedChat]
        );

        const {
            makeMessagePermanent,
            makeMessageTemporary,
            readMessageFile,
            readMessagePreview,
            writeMessagePreview,
        } = useChatSave({
            cloud,
            media,
            uid,
            chatBanned,
            chatPK,
            chatPrivateKey,
            localCache,
        });

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
            share,
        } = useChatSend({
            cloud,
            media,
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
            selectLocalChat,
            adoptLocalMessageMedia,
            readMessageFile,
        });
        resetSendingRef.current = resetSending;

        const { sendReaction } = useChatReact({
            cloud,
            uid,
            chatBanned,
            chatPK,
            chatPrivateKey,
            sendOptionsForPeer,
        });

        const { setChatTtl } = useChatSettings({
            cloud,
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
            (chatId, msgId, newMessage, peerChatPK) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                return updateMessageShared(cloud, chatId, msgId, chatPK, chatPrivateKey, peerChatPK, newMessage);
            },
            [cloud, chatBanned, chatPK, chatPrivateKey]
        );
        const getMessages = useCallback((chatId) => (isChatPendingDelete(chatId) ? [] : sortMessages(localByChat.get(chatId) ?? [])), [isChatPendingDelete, localByChat]);
        const deleteAllChats = useCallback(async () => {
            if (!uid || !chatPK || !chatPrivateKey) {
                return 0;
            }
            let processedInbox = true;
            while (processedInbox) {
                processedInbox = await processInbox(cloud, uid, chatPK, chatPrivateKey, { currentChats: lastServerChatsRef.current }).catch(() => false);
            }
            const allChats = await loadAllChatEntries(cloud, uid, chatPK, chatPrivateKey);
            if (!allChats.length) {
                return 0;
            }
            let deleted = 0;
            for (let index = 0; index < allChats.length; index += DELETE_ALL_CHATS_BATCH_SIZE) {
                deleted += await deleteChat(allChats.slice(index, index + DELETE_ALL_CHATS_BATCH_SIZE), { cleanup: false });
            }
            return deleted;
        }, [cloud, uid, chatPK, chatPrivateKey, deleteChat]);

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
                dropUnavailableChat,
                deleteChat,
                deleteAllChats,
                restoreDeletedChat,
                markChatReadReceipt,
                markChatRead,
                hasChat,
                getMessages,
                wasChatDeletedLocally,
                ackDeletedChat,
                sendMessage,
                retryMessage,
                sendAttachment,
                sendImage,
                sendAttachmentMany,
                sendImageMany,
                share,
                updateMessage,
                sendReaction,
                deleteMessage,
                deleteMessages,
                markMessagesHidden,
                setChatTtl,
                makeMessagePermanent,
                makeMessageTemporary,
                loadOlderMessages,
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
                getChatLastMsgKey,
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
                dropUnavailableChat,
                deleteChat,
                deleteAllChats,
                restoreDeletedChat,
                markChatReadReceipt,
                markChatRead,
                hasChat,
                getMessages,
                wasChatDeletedLocally,
                ackDeletedChat,
                sendMessage,
                retryMessage,
                sendAttachment,
                sendImage,
                sendAttachmentMany,
                sendImageMany,
                share,
                updateMessage,
                sendReaction,
                deleteMessage,
                deleteMessages,
                markMessagesHidden,
                setChatTtl,
                makeMessagePermanent,
                makeMessageTemporary,
                loadOlderMessages,
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
                getChatLastMsgKey,
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
