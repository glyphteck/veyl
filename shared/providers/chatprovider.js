'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getLatestOwnReadReceiptTarget, getLatestReadReceiptTarget, isLongTxt, makeSharedAttachment } from '../chat/messages.js';
import {
    attachmentBytes,
    getAttachmentType,
    isAttachmentType,
    makeChatUnavailableError,
    makeTxtFileAttachment,
    saveMedia,
} from '../chat/attachments.js';
import {
    applyReadCache,
    filterPendingDeleteChats,
    getLastChat,
    getPeersFromChats,
    sameChats,
    sameLastChat,
    setLocalChats,
    timestampMs,
} from '../chat/chats.js';
import {
    LOCAL_FAILED,
    LOCAL_PENDING,
    LOCAL_SENT,
    addLocalMessage,
    addLocalMessageToChats,
    makeLocalMessage,
    makeLongTxtLocalMessage,
    makeSendCid,
    makeSendMessage,
    makeSentLongTxtMessage,
    patchChatLastMessage,
    patchLastChatMessage,
    patchLocalMessageMap,
    prepareAttachment,
    retryAttachmentMeta,
    splitRetryMessage,
    updateLastChatWithLocal,
} from '../chat/send.js';
import { clearReadWrite, clearReadWrites, markChatsRead, scheduleReadReceiptWrite, readCandidate } from '../chat/read.js';
import { makeMessagePreviewMedia, MESSAGE_PREVIEW_MIME } from '../chat/previews.js';
import { useChatWarming } from '../chat/warming.js';
import {
    deleteMsg as deleteMessageShared,
    listenToLatestMsgs as listenToLatestMessagesShared,
    listenToChats as listenToChatsShared,
    readMsgMedia as readMessageFileShared,
    sendReadReceipt as sendReadReceiptShared,
    sendMsg as sendMessageShared,
    uploadAttachmentMsg as uploadAttachmentShared,
    uploadImgMsg as uploadImageShared,
    updateMsg as updateMessageShared,
    getPeerChatPKFromChatId,
    getChatRowLastMsgKey as getRowLastMsgKey,
    MSG_BATCH_SIZE,
} from '../chat/utils.js';
import { sortMessages } from '../chat/state.js';
import { dropCachedChat, readCachedChats, readCachedMedia, writeCachedChats, writeCachedMedia } from '../localdatacache.js';

export const DEFAULT_READ_RECEIPT_WRITE_DELAY_MS = 1200;
export const DEFAULT_MSG_BATCH_SIZE = MSG_BATCH_SIZE;

export function createChat({ db, storage, getStorage, uploadAttachment: uploadAttachmentImpl, uploadImage: uploadImageImpl, readMessageFile: readMessageFileImpl }) {
    if (!db) {
        throw new Error('createChat requires db');
    }

    function resolveStorage() {
        return typeof getStorage === 'function' ? getStorage() : storage;
    }

    return {
        sendMessage(senderPubkey, senderPrivkey, receiverChatPK, message) {
            return sendMessageShared(db, senderPubkey, senderPrivkey, receiverChatPK, message);
        },
        sendReadReceipt(senderPubkey, senderPrivkey, receiverChatPK, target) {
            return sendReadReceiptShared(db, senderPubkey, senderPrivkey, receiverChatPK, target);
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
        listenToChats(userChatPK, userPrivKey, onUpdate, onError) {
            return listenToChatsShared(db, userChatPK, userPrivKey, onUpdate, onError);
        },
        listenToLatestMessages(chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError) {
            return listenToLatestMessagesShared(db, chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError);
        },
    };
}

export function createChatProvider({ chat, useUser, useVault, readReceiptWriteDelay = DEFAULT_READ_RECEIPT_WRITE_DELAY_MS, appState, chatWarming = false, preloadMessageMedia }) {
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

        const [chats, setChats] = useState([]);
        const [peers, setPeers] = useState([]);
        const [isChatDataReady, setIsChatDataReady] = useState(false);
        const [selectedChatId, setSelectedChatId] = useState(null);
        const [localByChat, setLocalByChat] = useState(new Map());
        const [lastChat, setLastChat] = useState(null);
        const [serverChatIds, setServerChatIds] = useState([]);
        const [isActive, setIsActive] = useState(() => !appState?.currentState || appState.currentState === 'active');

        const peersCache = useRef([]);
        const lastPeersKey = useRef('');
        const lastServerChatIdsKey = useRef('');
        const lastServerChatsRef = useRef([]);
        const serverChatIdsRef = useRef([]);
        const serverChatsReadyRef = useRef(false);
        const pendingDeleteIdsRef = useRef(new Set());
        const locallyDeletedChatIdsRef = useRef(new Set());
        const keepSelectedDeletedChatIdsRef = useRef(new Set());
        const readCacheRef = useRef(new Map());
        const pendingReadRef = useRef(new Map());
        const localByChatRef = useRef(new Map());
        const sendQueueRef = useRef([]);
        const sendQueueRunningRef = useRef(false);
        const sendQueueScheduledRef = useRef(false);
        const lastHydratedCacheKeyRef = useRef('');
        const chatsRef = useRef([]);

        useEffect(() => {
            localByChatRef.current = localByChat;
        }, [localByChat]);

        useEffect(() => {
            chatsRef.current = chats;
        }, [chats]);

        useEffect(() => {
            serverChatIdsRef.current = serverChatIds;
        }, [serverChatIds]);

        useEffect(() => {
            if (!appState?.addEventListener) {
                return;
            }

            const sub = appState.addEventListener('change', (nextState) => {
                setIsActive(nextState === 'active');
            });
            return () => sub?.remove?.();
        }, [appState]);

        const applyBatchReadReceipt = useCallback(
            (chatId, messages) => {
                if (!chatId || !chatPK || !Array.isArray(messages) || !messages.length) {
                    return;
                }

                const ownTarget = getLatestOwnReadReceiptTarget(messages, chatPK);
                if (!ownTarget || getLatestReadReceiptTarget(messages, chatPK)) {
                    return;
                }

                const readMs = timestampMs(ownTarget.ts);
                if (readMs == null || (readCacheRef.current.get(chatId) || 0) >= readMs) {
                    return;
                }

                readCacheRef.current.set(chatId, readMs);
                lastServerChatsRef.current = markChatsRead(lastServerChatsRef.current, chatId, ownTarget);
                setChats((prev) => {
                    const next = markChatsRead(prev, chatId, ownTarget);
                    if (sameChats(prev, next)) {
                        return prev;
                    }
                    writeCachedChats(localCache, next);
                    return next;
                });
            },
            [chatPK, localCache]
        );

        const { clear: clearMessageBatches, closeBatch: closeMessageBatch, ensureMessageBatch, getMessageBatch, releaseMessageBatch, subscribeMessageBatch, warm: warmChats } = useChatWarming({
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
            onRead: applyBatchReadReceipt,
        });

        const getChatRowLastMsgKey = useCallback((chatId) => {
            if (!chatId) {
                return null;
            }
            const serverChat = lastServerChatsRef.current.find((chatItem) => chatItem?.id === chatId);
            if (serverChat) {
                return getRowLastMsgKey(serverChat);
            }
            return getRowLastMsgKey(chatsRef.current.find((chatItem) => chatItem?.id === chatId));
        }, []);

        const cleanupChats = useCallback((ready = false) => {
            clearMessageBatches();
            setIsChatDataReady((prev) => (prev === ready ? prev : ready));
            setChats((prev) => (prev.length ? [] : prev));
            setPeers((prev) => (prev.length ? [] : prev));
            setSelectedChatId((prev) => (prev != null ? null : prev));
            setLocalByChat((prev) => (prev.size ? new Map() : prev));
            setLastChat((prev) => (prev ? null : prev));
            setServerChatIds((prev) => (prev.length ? [] : prev));
            peersCache.current = [];
            lastPeersKey.current = '';
            lastServerChatIdsKey.current = '';
            lastHydratedCacheKeyRef.current = '';
            lastServerChatsRef.current = [];
            serverChatIdsRef.current = [];
            serverChatsReadyRef.current = false;
            pendingDeleteIdsRef.current = new Set();
            locallyDeletedChatIdsRef.current = new Set();
            keepSelectedDeletedChatIdsRef.current = new Set();
            readCacheRef.current = new Map();
            localByChatRef.current = new Map();

            clearReadWrites(pendingReadRef.current);
            pendingReadRef.current = new Map();

            if (sendQueueRef.current.length) {
                const error = new Error('chat reset');
                sendQueueRef.current.forEach((job) => {
                    job.onError?.(error);
                    job.reject?.(error);
                });
            }
            sendQueueRef.current = [];
            sendQueueRunningRef.current = false;
            sendQueueScheduledRef.current = false;
        }, [clearMessageBatches]);

        const ackMessages = useCallback((chatId, keys) => {
            const acked = new Set((keys || []).filter(Boolean));
            if (!chatId || !acked.size) {
                return;
            }

            setLocalByChat((prev) => {
                const locals = prev.get(chatId);
                if (!locals?.length) {
                    return prev;
                }

                const nextLocals = locals.filter((message) => !message.cid || !acked.has(message.cid));
                if (nextLocals.length === locals.length) {
                    return prev;
                }

                const next = new Map(prev);
                if (nextLocals.length) {
                    next.set(chatId, nextLocals);
                } else {
                    next.delete(chatId);
                }
                return next;
            });

            const clearPending = (message) => {
                if (!message?.cid || !acked.has(message.cid)) {
                    return message;
                }
                return {
                    ...message,
                    pending: false,
                    failed: false,
                };
            };

            setChats((prev) =>
                prev.map((chatItem) => {
                    if (chatItem.id !== chatId) {
                        return chatItem;
                    }

                    return {
                        ...chatItem,
                        lastMsg: clearPending(chatItem.lastMsg),
                    };
                })
            );
            setLastChat((current) => {
                if (!current?.lastMsg?.cid || !acked.has(current.lastMsg.cid)) {
                    return current;
                }
                return {
                    ...current,
                    lastMsg: clearPending(current.lastMsg),
                };
            });
        }, []);

        const flushSendQueue = useCallback(() => {
            if (sendQueueRunningRef.current || sendQueueScheduledRef.current) {
                return;
            }

            sendQueueScheduledRef.current = true;
            setTimeout(async () => {
                sendQueueScheduledRef.current = false;
                if (sendQueueRunningRef.current) {
                    return;
                }

                const job = sendQueueRef.current.shift();
                if (!job) {
                    return;
                }

                sendQueueRunningRef.current = true;
                try {
                    await job.run();
                    job.onSuccess?.();
                    job.resolve?.();
                } catch (error) {
                    job.onError?.(error);
                    job.reject?.(error);
                } finally {
                    sendQueueRunningRef.current = false;
                    if (sendQueueRef.current.length) {
                        flushSendQueue();
                    }
                }
            }, 0);
        }, [chat]);

        const scheduleReadReceipt = useCallback(
            (chatId, message, lastMsgMs) => {
                scheduleReadReceiptWrite({
                    pendingRead: pendingReadRef.current,
                    chatId,
                    message,
                    lastMsgMs,
                    delay: readReceiptWriteDelay,
                    write: (pending) => chat.sendReadReceipt(chatPK, chatPrivateKey, pending.peerChatPK, pending.target),
                    onError: (error) => {
                        readCacheRef.current.delete(chatId);
                        console.warn('read receipt write failed', error);
                    },
                });
            },
            [chat, chatPK, chatPrivateKey, readReceiptWriteDelay]
        );

        const checkLastRead = useCallback(
            async (chatId, message, { sendReceipt = true } = {}) => {
                if (!chatId || !chatPK || !chatPrivateKey || !message?.id || String(message.id).startsWith('local:')) {
                    return;
                }

                const read = readCandidate({
                    chatId,
                    chatPK,
                    chatPrivateKey,
                    message,
                    readCache: readCacheRef.current,
                });
                if (!read) {
                    return;
                }

                setChats((prevChats) => {
                    const nextChats = markChatsRead(prevChats, chatId, read.lastMsg);
                    writeCachedChats(localCache, nextChats);
                    return nextChats;
                });

                readCacheRef.current.set(chatId, read.lastMsgMs);
                if (sendReceipt) {
                    scheduleReadReceipt(chatId, read.lastMsg, read.lastMsgMs);
                }
            },
            [chatPK, chatPrivateKey, localCache, scheduleReadReceipt]
        );

        useEffect(() => {
            if (chatBanned) {
                cleanupChats(true);
                return;
            }

            if (!chatPK || !chatPrivateKey || typeof chatPK !== 'string') {
                cleanupChats();
                return;
            }

            const hydrateKey = localCache?.id ? `${localCache.id}:${chatPK}` : '';
            if (hydrateKey && lastHydratedCacheKeyRef.current !== hydrateKey) {
                lastHydratedCacheKeyRef.current = hydrateKey;
                const cachedChats = readCachedChats(localCache).filter((chatItem) => {
                    return Array.isArray(chatItem?.participants) && chatItem.participants.includes(chatPK);
                });

                if (cachedChats.length) {
                    const shownChats = setLocalChats(filterPendingDeleteChats(cachedChats, pendingDeleteIdsRef.current), localByChatRef.current);
                    const cachedChatIds = cachedChats.map((chatItem) => chatItem.id).filter(Boolean);
                    const cachedPeers = getPeersFromChats(cachedChats, chatPK);
                    const cachedPeersKey = [...cachedPeers].sort().join('|');
                    const cachedChatIdsKey = cachedChatIds.join('|');

                    lastServerChatsRef.current = cachedChats;
                    serverChatIdsRef.current = cachedChatIds;
                    lastServerChatIdsKey.current = cachedChatIdsKey;
                    peersCache.current = cachedPeers;
                    lastPeersKey.current = cachedPeersKey;

                    setChats((prev) => (sameChats(prev, shownChats) ? prev : shownChats));
                    setPeers(cachedPeers);
                    setServerChatIds(cachedChatIds);
                    setSelectedChatId((currentId) => currentId || shownChats?.[0]?.id || null);
                    const nextLastChat = getLastChat(shownChats, chatPK);
                    setLastChat((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
                    warmChats(shownChats);
                }

                setIsChatDataReady(true);
            }

            if (!isActive) {
                return;
            }

            return chat.listenToChats(
                chatPK,
                chatPrivateKey,
                (nextChats, nextPeers) => {
                    const rawNextChats = Array.isArray(nextChats) ? nextChats : [];
                    const nextChatsWithRead = applyReadCache(rawNextChats, chatPK, readCacheRef.current);
                    serverChatsReadyRef.current = true;
                    lastServerChatsRef.current = nextChatsWithRead;
                    const nextChatIds = rawNextChats.map((chatItem) => chatItem.id);
                    const prevChatIds = new Set(serverChatIdsRef.current);
                    const nextChatIdsSet = new Set(nextChatIds);
                    const removedChatIds = [...prevChatIds].filter((id) => !nextChatIdsSet.has(id));

                    if (pendingDeleteIdsRef.current.size) {
                        for (const chatId of [...pendingDeleteIdsRef.current]) {
                            if (!nextChatIdsSet.has(chatId)) {
                                pendingDeleteIdsRef.current.delete(chatId);
                            }
                        }
                    }

                    let localForRender = localByChatRef.current;
                    if (removedChatIds.length) {
                        localForRender = new Map(localForRender);
                        let changed = false;
                        for (const chatId of removedChatIds) {
                            dropCachedChat(localCache, chatId);
                            closeMessageBatch(chatId);
                            if (localForRender.delete(chatId)) {
                                changed = true;
                            }

                            readCacheRef.current.delete(chatId);
                            clearReadWrite(pendingReadRef.current, chatId);
                        }

                        if (changed) {
                            localByChatRef.current = localForRender;
                            setLocalByChat(localForRender);
                        }
                    }

                    const shownChats = setLocalChats(filterPendingDeleteChats(nextChatsWithRead, pendingDeleteIdsRef.current), localForRender);
                    writeCachedChats(localCache, filterPendingDeleteChats(nextChatsWithRead, pendingDeleteIdsRef.current));
                    warmChats(shownChats);

                    setChats((prev) => (sameChats(prev, shownChats) ? prev : shownChats));

                    const peersKey = Array.isArray(nextPeers) ? [...nextPeers].sort().join('|') : '';
                    if (peersKey !== lastPeersKey.current) {
                        peersCache.current = Array.isArray(nextPeers) ? [...nextPeers] : [];
                        lastPeersKey.current = peersKey;
                        setPeers(peersCache.current);
                    }

                    const nextChatIdsKey = nextChatIds.join('|');
                    serverChatIdsRef.current = nextChatIds;
                    if (nextChatIdsKey !== lastServerChatIdsKey.current) {
                        lastServerChatIdsKey.current = nextChatIdsKey;
                        setServerChatIds(nextChatIds);
                    }

                    setSelectedChatId((currentId) => {
                        if (currentId && pendingDeleteIdsRef.current.has(currentId) && !keepSelectedDeletedChatIdsRef.current.has(currentId)) {
                            return shownChats?.[0]?.id || null;
                        }
                        return currentId || shownChats?.[0]?.id || null;
                    });
                    const nextLastChat = getLastChat(shownChats, chatPK);
                    setLastChat((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
                    setIsChatDataReady(true);
                },
                (error) => {
                    console.warn('Chat listener error', error);
                    cleanupChats();
                }
            );
        }, [chat, chatBanned, chatPK, chatPrivateKey, cleanupChats, closeMessageBatch, isActive, localCache, warmChats]);

        useEffect(() => () => cleanupChats(), [cleanupChats]);

        const hasChats = chats.length > 0;

        const startDeleteChat = useCallback(
            (chatId, options = {}) => {
                if (!chatId) {
                    return;
                }

                pendingDeleteIdsRef.current.add(chatId);
                locallyDeletedChatIdsRef.current.add(chatId);
                closeMessageBatch(chatId);
                if (options?.keepSelected) {
                    keepSelectedDeletedChatIdsRef.current.add(chatId);
                } else {
                    keepSelectedDeletedChatIdsRef.current.delete(chatId);
                }
                dropCachedChat(localCache, chatId);

                let nextLocalByChat = localByChatRef.current;
                if (nextLocalByChat.has(chatId)) {
                    nextLocalByChat = new Map(nextLocalByChat);
                    nextLocalByChat.delete(chatId);
                    localByChatRef.current = nextLocalByChat;
                    setLocalByChat(nextLocalByChat);
                }

                readCacheRef.current.delete(chatId);
                clearReadWrite(pendingReadRef.current, chatId);

                const nextVisibleChats = setLocalChats(filterPendingDeleteChats(lastServerChatsRef.current, pendingDeleteIdsRef.current), nextLocalByChat);
                setChats((prev) => (sameChats(prev, nextVisibleChats) ? prev : nextVisibleChats));
                const nextLastChat = getLastChat(nextVisibleChats, chatPK);
                setLastChat((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
                setSelectedChatId((current) => (current === chatId && !options?.keepSelected ? nextVisibleChats?.[0]?.id || null : current));
            },
            [chatPK, closeMessageBatch, localCache]
        );

        const restoreDeletedChat = useCallback(
            (chatId) => {
                if (!chatId) {
                    return;
                }

                pendingDeleteIdsRef.current.delete(chatId);
                locallyDeletedChatIdsRef.current.delete(chatId);
                keepSelectedDeletedChatIdsRef.current.delete(chatId);

                const nextVisibleChats = setLocalChats(filterPendingDeleteChats(lastServerChatsRef.current, pendingDeleteIdsRef.current), localByChatRef.current);
                setChats((prev) => (sameChats(prev, nextVisibleChats) ? prev : nextVisibleChats));
                const nextLastChat = getLastChat(nextVisibleChats, chatPK);
                setLastChat((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
                setSelectedChatId((current) => current || nextVisibleChats?.[0]?.id || null);
            },
            [chatPK]
        );

        const dropChat = useCallback(
            (chatId) => {
                if (!chatId) {
                    return;
                }

                setLocalByChat((prev) => {
                    if (!prev.has(chatId)) {
                        return prev;
                    }
                    const next = new Map(prev);
                    next.delete(chatId);
                    return next;
                });
                readCacheRef.current.delete(chatId);
                dropCachedChat(localCache, chatId);
                closeMessageBatch(chatId);

                clearReadWrite(pendingReadRef.current, chatId);

                setServerChatIds((prev) => prev.filter((id) => id !== chatId));
                setChats((prev) => {
                    const next = prev.filter((chatItem) => chatItem?.id !== chatId);
                    setLastChat(getLastChat(next, chatPK));
                    setSelectedChatId((current) => (current === chatId ? next?.[0]?.id || null : current));
                    return next;
                });
            },
            [chatPK, closeMessageBatch, localCache]
        );

        const selectChat = useCallback(
            (chatId) => {
                if (chatBanned) {
                    return;
                }
                ensureMessageBatch(chatId, {
                    source: 'route',
                    rowLastMsgKey: getChatRowLastMsgKey(chatId),
                });
                setSelectedChatId(chatId);
            },
            [chatBanned, ensureMessageBatch, getChatRowLastMsgKey]
        );

        const markChatReadReceipt = useCallback(
            (chatId, message) => {
                if (chatBanned || !chatId || !message) {
                    return;
                }
                void checkLastRead(chatId, message);
            },
            [chatBanned, checkLastRead]
        );

        const markChatRead = useCallback(
            (chatId, message) => {
                if (!chatId || !message) {
                    return;
                }
                void checkLastRead(chatId, message, { sendReceipt: false });
            },
            [checkLastRead]
        );

        const showLocalMessage = useCallback(
            (peerChatPK, message) => {
                const { chatId, cid, local, ms } = makeLocalMessage(chatPK, peerChatPK, message);

                setLocalByChat((prev) => addLocalMessage(prev, chatId, local));
                setChats((prev) => addLocalMessageToChats(prev, chatId, local, localByChatRef.current.get(chatId) || []));
                setLastChat((current) => updateLastChatWithLocal(current, peerChatPK, local, ms));

                return { chatId, cid };
            },
            [chatPK]
        );

        const markLocalStatus = useCallback((chatId, cid, patch) => {
            setLocalByChat((prev) => patchLocalMessageMap(prev, chatId, cid, patch));
            setChats((prev) => patchChatLastMessage(prev, chatId, cid, patch));
            setLastChat((current) => patchLastChatMessage(current, cid, patch));
        }, []);

        const queueSend = useCallback(
            (peerChatPK, message, run) => {
                const local = showLocalMessage(peerChatPK, message);

                return new Promise((resolve, reject) => {
                    sendQueueRef.current.push({
                        resolve,
                        reject,
                        onError: () => markLocalStatus(local.chatId, local.cid, LOCAL_FAILED),
                        onSuccess: () => markLocalStatus(local.chatId, local.cid, LOCAL_SENT),
                        run,
                    });
                    flushSendQueue();
                });
            },
            [flushSendQueue, markLocalStatus, showLocalMessage]
        );

        const sendMessage = useCallback(
            async (peerChatPK, message) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                if (isLongTxt(message)) {
                    const cid = makeSendCid(message);
                    const attachment = makeTxtFileAttachment(message);

                    if (!chatPK || !chatPrivateKey || !peerChatPK) {
                        const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, { cid, ...attachment, meta: attachment });
                        saveMedia(localCache, uploaded, attachment.data, attachment);
                        return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, makeSentLongTxtMessage(chatPK, cid, uploaded, message));
                    }

                    const localMessage = makeLongTxtLocalMessage(chatPK, cid, attachment, message);

                    return queueSend(peerChatPK, localMessage, async () => {
                        const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, { cid, ...attachment, meta: attachment });
                        saveMedia(localCache, uploaded, attachment.data, attachment);
                        await chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, makeSentLongTxtMessage(chatPK, cid, uploaded, message));
                    });
                }
                if (!chatPK || !chatPrivateKey || !peerChatPK) {
                    return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, message);
                }

                const queued = makeSendMessage(chatPK, message);

                return queueSend(peerChatPK, queued.message, () => chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, queued.message));
            },
            [chat, chatBanned, chatPK, chatPrivateKey, localCache, queueSend]
        );

        const retryMessage = useCallback(
            (chatId, cid) => {
                if (chatBanned || !chatPK || !chatPrivateKey || !chatId || !cid) {
                    return;
                }

                const locals = localByChatRef.current.get(chatId);
                const failedMsg = locals?.find((m) => m.cid === cid && m.failed);
                if (!failedMsg) {
                    return;
                }

                const peerChatPK = getPeerChatPKFromChatId(chatId, chatPK);
                if (!peerChatPK) {
                    return;
                }

                markLocalStatus(chatId, cid, LOCAL_PENDING);

                const { localUri, localData, payload } = splitRetryMessage(failedMsg);

                if (isAttachmentType(failedMsg?.t) && localData) {
                    const meta = retryAttachmentMeta(failedMsg, localUri);

                    return new Promise((resolve, reject) => {
                        sendQueueRef.current.push({
                            resolve,
                            reject,
                            onError: () => markLocalStatus(chatId, cid, LOCAL_FAILED),
                            onSuccess: () => markLocalStatus(chatId, cid, LOCAL_SENT),
                            run: async () => {
                                const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, {
                                    cid,
                                    type: failedMsg.t,
                                    data: localData,
                                    meta,
                                });
                                saveMedia(localCache, uploaded, localData, meta);
                                await chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, { ...uploaded, cid, s: chatPK });
                            },
                        });
                        flushSendQueue();
                    });
                }

                return new Promise((resolve, reject) => {
                    sendQueueRef.current.push({
                        resolve,
                        reject,
                        onError: () => markLocalStatus(chatId, cid, LOCAL_FAILED),
                        run: () => chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, payload),
                    });
                    flushSendQueue();
                });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, flushSendQueue, localCache, markLocalStatus]
        );

        const sendAttachment = useCallback(
            async (peerChatPK, attachment) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const { cid, nextAttachment, localMessage } = prepareAttachment(chatPK, attachment);

                if (!chatPK || !chatPrivateKey || !peerChatPK) {
                    const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, nextAttachment);
                    saveMedia(localCache, uploaded, attachment?.data, attachment);
                    return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, { ...uploaded, cid, s: chatPK });
                }

                return queueSend(peerChatPK, localMessage, async () => {
                    const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, nextAttachment);
                    saveMedia(localCache, uploaded, attachment?.data, attachment);
                    await chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, { ...uploaded, cid, s: chatPK });
                });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, localCache, queueSend]
        );
        const sendImage = useCallback((peerChatPK, image) => sendAttachment(peerChatPK, { ...image, type: 'img' }), [sendAttachment]);
        const shareAttachment = useCallback(
            async (peerChatPK, message) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const shared = makeSharedAttachment(message);
                if (!chatPK || !chatPrivateKey || !peerChatPK) {
                    return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, shared);
                }

                const queued = makeSendMessage(chatPK, shared);
                return queueSend(peerChatPK, queued.message, () => chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, queued.message));
            },
            [chat, chatBanned, chatPK, chatPrivateKey, queueSend]
        );
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
        const readMessageFile = useCallback(
            async (peerChatPK, message) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                if ((String(message?.p || '').startsWith('local:') || message?.k === 'local') && message?.localData != null) {
                    const localBytes = await attachmentBytes(message.localData);
                    if (localBytes) {
                        return localBytes;
                    }
                }
                const cached = await readCachedMedia(localCache, message);
                if (cached?.byteLength) {
                    return cached;
                }

                const bytes = await chat.readMessageFile(chatPK, chatPrivateKey, peerChatPK, message);
                saveMedia(localCache, message, bytes, message);
                return bytes;
            },
            [chat, chatBanned, chatPK, chatPrivateKey, localCache]
        );
        const readMessagePreview = useCallback(
            async (message) => {
                const previewMessage = makeMessagePreviewMedia(message);
                if (!previewMessage) {
                    return null;
                }
                return readCachedMedia(localCache, previewMessage);
            },
            [localCache]
        );
        const writeMessagePreview = useCallback(
            async (message, bytes, meta = {}) => {
                const mimeType = meta?.mimeType || MESSAGE_PREVIEW_MIME;
                const previewMessage = makeMessagePreviewMedia(message, mimeType);
                if (!previewMessage || !bytes?.byteLength) {
                    return false;
                }
                return writeCachedMedia(localCache, previewMessage, bytes, {
                    ...meta,
                    mimeType,
                });
            },
            [localCache]
        );
        const serverChatIdsSet = useMemo(() => new Set(serverChatIds), [serverChatIds]);
        const hasChatDoc = useCallback((chatId) => serverChatIdsSet.has(chatId) && !pendingDeleteIdsRef.current.has(chatId), [serverChatIdsSet]);
        const getMessages = useCallback((chatId) => (pendingDeleteIdsRef.current.has(chatId) ? [] : sortMessages(localByChat.get(chatId) ?? [])), [localByChat]);
        const wasChatDeletedLocally = useCallback((chatId) => !!chatId && locallyDeletedChatIdsRef.current.has(chatId), []);
        const ackDeletedChat = useCallback((chatId) => {
            if (!chatId) {
                return;
            }
            locallyDeletedChatIdsRef.current.delete(chatId);
        }, []);

        const value = useMemo(
            () => ({
                chats,
                peers,
                chatBanned,
                isChatDataReady,
                hasChats,
                selectedChatId,
                selectChat,
                dropChat,
                startDeleteChat,
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
                shareAttachment,
                updateMessage,
                deleteMessage,
                readMessageFile,
                readMessagePreview,
                writeMessagePreview,
                ackMessages,
                lastChat,
                ensureMessageBatch,
                releaseMessageBatch,
                subscribeMessageBatch,
                getMessageBatch,
                getChatRowLastMsgKey,
            }),
            [
                chats,
                peers,
                chatBanned,
                isChatDataReady,
                hasChats,
                selectedChatId,
                selectChat,
                dropChat,
                startDeleteChat,
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
                shareAttachment,
                updateMessage,
                deleteMessage,
                readMessageFile,
                readMessagePreview,
                writeMessagePreview,
                ackMessages,
                lastChat,
                ensureMessageBatch,
                releaseMessageBatch,
                subscribeMessageBatch,
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
