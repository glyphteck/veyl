'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { canShowMsg, getLatestOwnReadReceiptTarget, getLatestReadReceiptTarget, hasStoredFileRef, isAttachmentMsgType, isExpiredAttachmentMsg, isLongTxt, isPeerMsg, makeSharedAttachment } from '../chat/messages.js';
import { CHAT_MEDIA_TTL_MS, getMediaFileId } from '../chat/filepayload.js';
import { getChatId } from '../crypto/chat.js';
import {
    attachmentBytes,
    getAttachmentType,
    isFileGoneError,
    isAttachmentType,
    makeChatUnavailableError,
    makeFileGoneError,
    makeTxtFileAttachment,
    saveMedia,
} from '../chat/attachments.js';
import {
    applyReadCache,
    clearChatPreviewsByHiddenKeys,
    clearChatPreviewsByKeys,
    clearChatPreviewsByMessages,
    collectMessageKeys,
    filterPendingDeleteChats,
    getLastChat,
    getPeersFromChats,
    nextChatPreviewExpiryMs,
    sameChats,
    sameLastChat,
    setLocalChats,
    timestampMs,
    trimExpiredChatPreviews,
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
    makeMsgPermanent as makeMessagePermanentShared,
    makeMsgTemporary as makeMessageTemporaryShared,
    listenToChats as listenToChatsShared,
    readMsgMedia as readMessageFileShared,
    sendReadReceipt as sendReadReceiptShared,
    sendReaction as sendReactionShared,
    sendMsg as sendMessageShared,
    setChatRetention as setChatRetentionShared,
    uploadAttachmentMsg as uploadAttachmentShared,
    uploadImgMsg as uploadImageShared,
    updateMsg as updateMessageShared,
    updateSeenMsgTtls as updateSeenMessageTtlsShared,
    getPeerChatPKFromChatId,
    getChatRowLastMsgKey as getRowLastMsgKey,
    MSG_BATCH_SIZE,
} from '../chat/utils.js';
import { CHAT_RETENTION_24H, CHAT_RETENTION_SEEN, cleanChatRetention, getMessageRetention, normalizeChatSettings, onSeenMessageTtlMs, seenMessageTtlMs, shouldShortenTtl, withMessageRetention } from '../chat/ttl.js';
import { sortMessages } from '../chat/state.js';
import { dropCachedChat, dropCachedMedia, readCachedChats, readCachedMedia, writeCachedChats, writeCachedMedia } from '../localdatacache.js';
import { randomBytes, toHex } from '../crypto/core.js';

export const DEFAULT_READ_RECEIPT_WRITE_DELAY_MS = 1200;
export const DEFAULT_MSG_BATCH_SIZE = MSG_BATCH_SIZE;

function localMediaAdoptionKey(chatId, cid, message) {
    if (!chatId || !cid || !message?.p || !message?.k || String(message.p).startsWith('local:') || message.k === 'local') {
        return '';
    }
    return `${chatId}\n${cid}\n${message.p}\n${message.k}`;
}

function uniqueChatTargets(peerChatPKs) {
    const list = Array.isArray(peerChatPKs) ? peerChatPKs : [peerChatPKs];
    const seen = new Set();
    const targets = [];
    for (const peerChatPK of list) {
        const target = typeof peerChatPK === 'string' ? peerChatPK.trim() : '';
        if (!target || seen.has(target)) {
            continue;
        }
        seen.add(target);
        targets.push(target);
    }
    return targets;
}

function hasInvalidStoredMediaRef(message) {
    const path = typeof message?.p === 'string' ? message.p.trim() : '';
    const fileKey = typeof message?.k === 'string' ? message.k.trim() : '';
    if (!path || !fileKey || path.startsWith('local:') || fileKey === 'local') {
        return false;
    }

    try {
        getMediaFileId(path);
        return false;
    } catch {
        return true;
    }
}

function shouldUploadPermanentMedia(attachment) {
    return attachment?.permanent === true || attachment?.meta?.permanent === true;
}

function attachmentWithPermanence(attachment, permanent, stayId = '') {
    if (!permanent) {
        return attachment;
    }
    return {
        ...attachment,
        meta: {
            ...(attachment?.meta || {}),
            permanent: true,
            stay: stayId,
        },
    };
}

function mediaStay(message) {
    const stay = typeof message?.stay === 'string' ? message.stay.trim() : '';
    return stay || newMediaStayId();
}

function newMediaStayId() {
    return toHex(randomBytes(16));
}

function makeSavedMessagePayload(message, stayId) {
    const { id, ts, ttl, from, pending, failed, localUri, localData, reactions, type, ...payload } = message || {};
    const savedTtl = timestampMs(ttl);
    return {
        ...payload,
        ...(Number.isFinite(savedTtl) ? { savedTtl } : {}),
        ...(stayId
            ? {
                  x: Number.isFinite(payload.x) ? payload.x : Date.now() + CHAT_MEDIA_TTL_MS,
                  stay: stayId,
              }
            : {}),
    };
}

function makeUnsavedMessagePayload(message) {
    const { id, ts, ttl, from, pending, failed, localUri, localData, reactions, type, stay, savedTtl, savedTtlMs, permanent, ...payload } = message || {};
    if (!isAttachmentMsgType(message?.t)) {
        return payload;
    }
    return {
        ...payload,
        x: Number.isFinite(payload.x) ? payload.x : Date.now() + CHAT_MEDIA_TTL_MS,
    };
}

function temporaryTtlMs(value, message, now = Date.now()) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) {
        return null;
    }
    const mediaExpiresAt = isAttachmentMsgType(message?.t) && Number.isFinite(message?.x) ? message.x : Infinity;
    const maxTtlMs = Math.min(mediaExpiresAt, now + CHAT_MEDIA_TTL_MS);
    return Math.max(now + 1000, Math.min(ms, maxTtlMs));
}

function unsavedMessageTtlMs(message, ttlMs) {
    const now = Date.now();
    const requestedTtlMs = temporaryTtlMs(ttlMs, message, now);
    if (requestedTtlMs != null) {
        return requestedTtlMs;
    }
    const savedTtlMs = temporaryTtlMs(message?.savedTtl, message, now);
    if (savedTtlMs != null) {
        return savedTtlMs;
    }
    const expiresAt = Number.isFinite(message?.x) ? message.x : now + CHAT_MEDIA_TTL_MS;
    return Math.max(now + 1000, Math.min(expiresAt, now + CHAT_MEDIA_TTL_MS));
}

function hasSavedMessagePayload(message) {
    return message?.permanent === true || Number.isFinite(Number(message?.savedTtl)) || (typeof message?.stay === 'string' && message.stay.trim().length > 0);
}

async function requireMediaSaved(chat, path, stayId, saved) {
    const updated = await chat.setMediaSaved(path, stayId, saved);
    if (updated !== true) {
        throw new Error('media save state unavailable');
    }
}

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
        updateSeenTtl(chatId, messages, ttlMs) {
            return updateSeenMessageTtlsShared(db, chatId, messages, ttlMs);
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
        listenToChats(userChatPK, userPrivKey, onUpdate, onError) {
            return listenToChatsShared(db, userChatPK, userPrivKey, onUpdate, onError);
        },
        listenToLatestMessages(chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError) {
            return listenToLatestMessagesShared(db, chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError);
        },
    };
}

export function createChatProvider({ chat, useUser, useVault, readReceiptWriteDelay = DEFAULT_READ_RECEIPT_WRITE_DELAY_MS, appState, chatWarming = false, preloadMessageMedia, adoptLocalMessageMedia }) {
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
        const pendingDeleteWaitersRef = useRef(new Map());
        const deletingChatIdsRef = useRef(new Set());
        const finalizingDeleteIdsRef = useRef(new Set());
        const locallyDeletedChatIdsRef = useRef(new Set());
        const keepSelectedDeletedChatIdsRef = useRef(new Set());
        const readCacheRef = useRef(new Map());
        const pendingReadRef = useRef(new Map());
        const localByChatRef = useRef(new Map());
        const hiddenChatPreviewKeysRef = useRef(new Map());
        const sendQueueRef = useRef([]);
        const sendQueueRunningRef = useRef(false);
        const sendQueueScheduledRef = useRef(false);
        const sendGenerationRef = useRef(0);
        const lastHydratedCacheKeyRef = useRef('');
        const chatsRef = useRef([]);
        const adoptedLocalMediaRef = useRef(new Set());
        const cachedLocalMediaRef = useRef(new Set());
        const seenTtlRef = useRef(new Set());

        const updateRenderedChats = useCallback(
            (nextChats) => {
                const filteredChats = clearChatPreviewsByHiddenKeys(trimExpiredChatPreviews(nextChats, { skipChatId: selectedChatId }), hiddenChatPreviewKeysRef.current);
                const shownChats = setLocalChats(filterPendingDeleteChats(filteredChats, pendingDeleteIdsRef.current), localByChatRef.current);
                setChats((prev) => (sameChats(prev, shownChats) ? prev : shownChats));
                const nextLastChat = getLastChat(shownChats, chatPK);
                setLastChat((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
                return shownChats;
            },
            [chatPK, selectedChatId]
        );

        const rememberHiddenChatPreviewKeys = useCallback((chatId, keys) => {
            const nextKeys = keys instanceof Set ? keys : collectMessageKeys(keys);
            if (!chatId || !nextKeys.size) {
                return false;
            }
            const current = hiddenChatPreviewKeysRef.current.get(chatId) || new Set();
            let changed = false;
            for (const key of nextKeys) {
                if (!current.has(key)) {
                    current.add(key);
                    changed = true;
                }
            }
            if (changed) {
                hiddenChatPreviewKeysRef.current.set(chatId, current);
            }
            return changed;
        }, []);

        const rememberHiddenChatPreviews = useCallback(
            (chatId, messages) => {
                return rememberHiddenChatPreviewKeys(chatId, collectMessageKeys(messages));
            },
            [rememberHiddenChatPreviewKeys]
        );

        const clearChatPreviewKeys = useCallback(
            (chatId, keys) => {
                const remembered = rememberHiddenChatPreviewKeys(chatId, keys);
                const nextServerChats = clearChatPreviewsByHiddenKeys(clearChatPreviewsByKeys(lastServerChatsRef.current, chatId, keys), hiddenChatPreviewKeysRef.current);
                if (!remembered && nextServerChats === lastServerChatsRef.current) {
                    return;
                }
                lastServerChatsRef.current = nextServerChats;
                writeCachedChats(localCache, filterPendingDeleteChats(nextServerChats, pendingDeleteIdsRef.current));
                updateRenderedChats(nextServerChats);
            },
            [localCache, rememberHiddenChatPreviewKeys, updateRenderedChats]
        );

        const clearChatPreviewMessages = useCallback(
            (chatId, messages) => {
                const remembered = rememberHiddenChatPreviews(chatId, messages);
                const nextServerChats = clearChatPreviewsByHiddenKeys(clearChatPreviewsByMessages(lastServerChatsRef.current, chatId, messages), hiddenChatPreviewKeysRef.current);
                if (!remembered && nextServerChats === lastServerChatsRef.current) {
                    return;
                }
                lastServerChatsRef.current = nextServerChats;
                writeCachedChats(localCache, filterPendingDeleteChats(nextServerChats, pendingDeleteIdsRef.current));
                updateRenderedChats(nextServerChats);
            },
            [localCache, rememberHiddenChatPreviews, updateRenderedChats]
        );

        const finishPendingDeleteWait = useCallback((chatId) => {
            const waiters = pendingDeleteWaitersRef.current.get(chatId);
            if (!waiters) {
                return;
            }
            pendingDeleteWaitersRef.current.delete(chatId);
            for (const resolve of waiters) {
                resolve();
            }
        }, []);

        const isChatWriteBlocked = useCallback((chatId) => {
            return !!chatId && (pendingDeleteIdsRef.current.has(chatId) || deletingChatIdsRef.current.has(chatId));
        }, []);

        const releaseChatWriteWait = useCallback(
            (chatId) => {
                if (!isChatWriteBlocked(chatId)) {
                    finishPendingDeleteWait(chatId);
                }
            },
            [finishPendingDeleteWait, isChatWriteBlocked]
        );

        const releaseReadyChatWriteWaits = useCallback(() => {
            for (const chatId of pendingDeleteWaitersRef.current.keys()) {
                releaseChatWriteWait(chatId);
            }
        }, [releaseChatWriteWait]);

        const finishDeletingParent = useCallback(
            (chatId) => {
                if (!chatId || pendingDeleteIdsRef.current.has(chatId) || !deletingChatIdsRef.current.has(chatId) || finalizingDeleteIdsRef.current.has(chatId)) {
                    return;
                }
                finalizingDeleteIdsRef.current.add(chatId);
                void chat
                    .finishDeletingChat(chatId)
                    .catch(() => {})
                    .finally(() => {
                        finalizingDeleteIdsRef.current.delete(chatId);
                    });
            },
            [chat]
        );

        const waitForPendingDelete = useCallback(
            (chatId) => {
                if (!chatId || !isChatWriteBlocked(chatId)) {
                    return Promise.resolve();
                }

                finishDeletingParent(chatId);

                return new Promise((resolve) => {
                    const remove = (done) => {
                        const waiters = pendingDeleteWaitersRef.current.get(chatId);
                        if (!waiters) {
                            return;
                        }
                        const next = waiters.filter((waiter) => waiter !== done);
                        if (next.length) {
                            pendingDeleteWaitersRef.current.set(chatId, next);
                        } else {
                            pendingDeleteWaitersRef.current.delete(chatId);
                        }
                    };
                    const done = () => {
                        remove(done);
                        resolve();
                    };
                    const waiters = pendingDeleteWaitersRef.current.get(chatId) || [];
                    pendingDeleteWaitersRef.current.set(chatId, [...waiters, done]);
                });
            },
            [finishDeletingParent, isChatWriteBlocked]
        );

        const waitForPeerDelete = useCallback(
            (peerChatPK) => {
                if (!chatPK || !peerChatPK) {
                    return Promise.resolve();
                }
                return waitForPendingDelete(getChatId(chatPK, peerChatPK));
            },
            [chatPK, waitForPendingDelete]
        );

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
            onRead: applyBatchReadReceipt,
            onExpire: clearChatPreviewKeys,
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

        const getChatRetention = useCallback((chatId) => {
            if (!chatId) {
                return CHAT_RETENTION_24H;
            }
            const serverChat = lastServerChatsRef.current.find((chatItem) => chatItem?.id === chatId);
            if (serverChat) {
                return normalizeChatSettings(serverChat.settings).retention;
            }
            const visibleChat = chatsRef.current.find((chatItem) => chatItem?.id === chatId);
            return normalizeChatSettings(visibleChat?.settings).retention;
        }, []);

        const getPeerChatRetention = useCallback(
            (peerChatPK) => {
                if (!chatPK || !peerChatPK) {
                    return CHAT_RETENTION_24H;
                }
                return getChatRetention(getChatId(chatPK, peerChatPK));
            },
            [chatPK, getChatRetention]
        );

        const hasServerChatForPeer = useCallback(
            (peerChatPK) => {
                if (!chatPK || !peerChatPK) {
                    return false;
                }
                const chatId = getChatId(chatPK, peerChatPK);
                return serverChatIdsRef.current.includes(chatId) || lastServerChatsRef.current.some((chatItem) => chatItem?.id === chatId);
            },
            [chatPK]
        );

        const sendOptionsForPeer = useCallback((peerChatPK) => ({ retention: getPeerChatRetention(peerChatPK), chatExists: hasServerChatForPeer(peerChatPK) }), [getPeerChatRetention, hasServerChatForPeer]);

        const cleanupChats = useCallback((ready = false) => {
            sendGenerationRef.current += 1;
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
            deletingChatIdsRef.current = new Set();
            finalizingDeleteIdsRef.current = new Set();
            hiddenChatPreviewKeysRef.current = new Map();
            for (const waiters of pendingDeleteWaitersRef.current.values()) {
                for (const resolve of waiters) {
                    resolve();
                }
            }
            pendingDeleteWaitersRef.current = new Map();
            locallyDeletedChatIdsRef.current = new Set();
            keepSelectedDeletedChatIdsRef.current = new Set();
            readCacheRef.current = new Map();
            localByChatRef.current = new Map();
            adoptedLocalMediaRef.current.clear();
            cachedLocalMediaRef.current.clear();
            seenTtlRef.current.clear();

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

        const ackMessages = useCallback((chatId, messages) => {
            const acked = new Set((messages || []).map((message) => (typeof message === 'string' ? message : message?.cid || message?.id)).filter(Boolean));
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
                if (!message.pending && !message.failed) {
                    return message;
                }
                return {
                    ...message,
                    pending: false,
                    failed: false,
                };
            };

            setChats((prev) => {
                let changed = false;
                const next = prev.map((chatItem) => {
                    if (chatItem.id !== chatId) {
                        return chatItem;
                    }
                    const lastMsg = clearPending(chatItem.lastMsg);
                    if (lastMsg === chatItem.lastMsg) {
                        return chatItem;
                    }
                    changed = true;

                    return {
                        ...chatItem,
                        lastMsg,
                    };
                });
                return changed ? next : prev;
            });
            setLastChat((current) => {
                if (!current?.lastMsg?.cid || !acked.has(current.lastMsg.cid)) {
                    return current;
                }
                const lastMsg = clearPending(current.lastMsg);
                if (lastMsg === current.lastMsg) {
                    return current;
                }
                return {
                    ...current,
                    lastMsg,
                };
            });
        }, []);

        const adoptConfirmedMessages = useCallback(
            (chatId, messages) => {
                const locals = localByChatRef.current.get(chatId);
                if (!chatId || !locals?.length || !messages?.length) {
                    return messages || [];
                }

                const localByCid = new Map();
                for (const local of locals) {
                    if (local?.cid && isAttachmentMsgType(local.t) && (local.localUri || local.localData != null)) {
                        localByCid.set(local.cid, local);
                    }
                }
                if (!localByCid.size) {
                    return messages;
                }

                let changed = false;
                const nextMessages = messages.map((message) => {
                    const local = localByCid.get(message?.cid);
                    const stored = isAttachmentMsgType(message?.t) && hasStoredFileRef(message);
                    if (!local || !stored) {
                        return message;
                    }

                    const mediaKey = localMediaAdoptionKey(chatId, message.cid, message);
                    if (mediaKey && !cachedLocalMediaRef.current.has(mediaKey) && local.localData != null) {
                        cachedLocalMediaRef.current.add(mediaKey);
                        saveMedia(localCache, message, local.localData, message);
                    }
                    if (message?.t === 'img' && mediaKey && !adoptedLocalMediaRef.current.has(mediaKey)) {
                        adoptedLocalMediaRef.current.add(mediaKey);
                        adoptLocalMessageMedia?.(message, local);
                    }

                    if (!local.localUri || message.localUri === local.localUri) {
                        return message;
                    }

                    changed = true;
                    return {
                        ...message,
                        localUri: local.localUri,
                    };
                });

                return changed ? nextMessages : messages;
            },
            [adoptLocalMessageMedia, localCache]
        );

        const rememberCachedLocalMedia = useCallback((peerChatPK, cid, message) => {
            if (!chatPK || !peerChatPK) {
                return;
            }
            const key = localMediaAdoptionKey(getChatId(chatPK, peerChatPK), cid, message);
            if (key) {
                cachedLocalMediaRef.current.add(key);
            }
        }, [chatPK]);

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
                    const result = await job.run();
                    job.onSuccess?.();
                    job.resolve?.(result);
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
                    write: (pending) => chat.sendReadReceipt(chatPK, chatPrivateKey, pending.peerChatPK, pending.target, { retention: getChatRetention(chatId) }),
                    onError: () => {
                        readCacheRef.current.delete(chatId);
                    },
                });
            },
            [chat, chatPK, chatPrivateKey, getChatRetention, readReceiptWriteDelay]
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
                const cachedChats = clearChatPreviewsByHiddenKeys(
                    trimExpiredChatPreviews(readCachedChats(localCache).filter((chatItem) => Array.isArray(chatItem?.participants) && chatItem.participants.includes(chatPK))),
                    hiddenChatPreviewKeysRef.current
                ).filter((chatItem) => chatItem?.lastMsg || !!chatItem?.ts);

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
                (nextChats, nextPeers, meta = {}) => {
                    const rawNextChats = Array.isArray(nextChats) ? nextChats : [];
                    const deletingChatIds = Array.isArray(meta?.deletingChatIds) ? meta.deletingChatIds.filter(Boolean) : [];
                    const deletingChatIdsSet = new Set(deletingChatIds);
                    const nextChatsWithRead = clearChatPreviewsByHiddenKeys(trimExpiredChatPreviews(applyReadCache(rawNextChats, chatPK, readCacheRef.current), { skipChatId: selectedChatId }), hiddenChatPreviewKeysRef.current);
                    serverChatsReadyRef.current = true;
                    deletingChatIdsRef.current = deletingChatIdsSet;
                    lastServerChatsRef.current = nextChatsWithRead;
                    const nextChatIds = rawNextChats.map((chatItem) => chatItem.id);
                    const prevChatIds = new Set(serverChatIdsRef.current);
                    const nextChatIdsSet = new Set(nextChatIds);
                    const liveChatIdsSet = new Set([...nextChatIds, ...deletingChatIds]);
                    const removedChatIds = [...prevChatIds].filter((id) => !nextChatIdsSet.has(id));

                    if (pendingDeleteIdsRef.current.size) {
                        for (const chatId of [...pendingDeleteIdsRef.current]) {
                            if (!liveChatIdsSet.has(chatId)) {
                                pendingDeleteIdsRef.current.delete(chatId);
                                releaseChatWriteWait(chatId);
                            }
                        }
                    }
                    releaseReadyChatWriteWaits();

                    let localForRender = localByChatRef.current;
                    if (removedChatIds.length) {
                        localForRender = new Map(localForRender);
                        let changed = false;
                        for (const chatId of removedChatIds) {
                            dropCachedChat(localCache, chatId);
                            closeMessageBatch(chatId);
                            hiddenChatPreviewKeysRef.current.delete(chatId);
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
        }, [chat, chatBanned, chatPK, chatPrivateKey, cleanupChats, closeMessageBatch, isActive, localCache, releaseChatWriteWait, releaseReadyChatWriteWaits, selectedChatId, warmChats]);

        useEffect(() => {
            const nextExpiryMs = nextChatPreviewExpiryMs(chats, Date.now(), { skipChatId: selectedChatId });
            if (nextExpiryMs == null) {
                return undefined;
            }

            const delay = Math.max(0, Math.min(nextExpiryMs - Date.now() + 25, 2_147_483_647));
            const timeout = setTimeout(() => {
                const nextServerChats = trimExpiredChatPreviews(lastServerChatsRef.current, { skipChatId: selectedChatId });
                if (nextServerChats !== lastServerChatsRef.current) {
                    lastServerChatsRef.current = nextServerChats;
                    writeCachedChats(localCache, filterPendingDeleteChats(nextServerChats, pendingDeleteIdsRef.current));
                    updateRenderedChats(nextServerChats);
                    return;
                }

                setChats((prev) => {
                    const next = clearChatPreviewsByHiddenKeys(trimExpiredChatPreviews(prev, { skipChatId: selectedChatId }), hiddenChatPreviewKeysRef.current);
                    if (sameChats(prev, next)) {
                        return prev;
                    }
                    const nextLastChat = getLastChat(next, chatPK);
                    setLastChat((current) => (sameLastChat(current, nextLastChat) ? current : nextLastChat));
                    return next;
                });
            }, delay);

            return () => clearTimeout(timeout);
        }, [chatPK, chats, localCache, selectedChatId, updateRenderedChats]);

        useEffect(() => () => cleanupChats(), [cleanupChats]);

        const hasChats = chats.length > 0;

        const startDeleteChat = useCallback(
            (chatId, options = {}) => {
                if (!chatId) {
                    return;
                }

                pendingDeleteIdsRef.current.add(chatId);
                locallyDeletedChatIdsRef.current.add(chatId);
                hiddenChatPreviewKeysRef.current.delete(chatId);
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
                hiddenChatPreviewKeysRef.current.delete(chatId);
                releaseChatWriteWait(chatId);

                const nextVisibleChats = setLocalChats(filterPendingDeleteChats(lastServerChatsRef.current, pendingDeleteIdsRef.current), localByChatRef.current);
                setChats((prev) => (sameChats(prev, nextVisibleChats) ? prev : nextVisibleChats));
                const nextLastChat = getLastChat(nextVisibleChats, chatPK);
                setLastChat((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
                setSelectedChatId((current) => current || nextVisibleChats?.[0]?.id || null);
            },
            [chatPK, releaseChatWriteWait]
        );

        const finishDeleteChat = useCallback(
            (chatId) => {
                if (!chatId) {
                    return;
                }

                pendingDeleteIdsRef.current.delete(chatId);
                locallyDeletedChatIdsRef.current.delete(chatId);
                keepSelectedDeletedChatIdsRef.current.delete(chatId);
                hiddenChatPreviewKeysRef.current.delete(chatId);
                lastServerChatsRef.current = lastServerChatsRef.current.filter((chatItem) => chatItem?.id !== chatId);
                serverChatIdsRef.current = serverChatIdsRef.current.filter((id) => id !== chatId);
                setServerChatIds((prev) => prev.filter((id) => id !== chatId));
                releaseChatWriteWait(chatId);
            },
            [releaseChatWriteWait]
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
                hiddenChatPreviewKeysRef.current.delete(chatId);
                dropCachedChat(localCache, chatId);
                closeMessageBatch(chatId);

                clearReadWrite(pendingReadRef.current, chatId);
                finishPendingDeleteWait(chatId);

                setServerChatIds((prev) => prev.filter((id) => id !== chatId));
                setChats((prev) => {
                    const next = prev.filter((chatItem) => chatItem?.id !== chatId);
                    setLastChat(getLastChat(next, chatPK));
                    setSelectedChatId((current) => (current === chatId ? next?.[0]?.id || null : current));
                    return next;
                });
            },
            [chatPK, closeMessageBatch, finishPendingDeleteWait, localCache]
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

        const markMessagesSeenTtl = useCallback(
            (chatId, messages) => {
                if (chatBanned || !chatId || !Array.isArray(messages) || !messages.length) {
                    return;
                }

                const nextTtlMs = seenMessageTtlMs();
                const candidates = [];
                const keys = [];
                for (const message of messages) {
                    const id = typeof message?.id === 'string' ? message.id.trim() : '';
                    if (!id || id.startsWith('local:') || getMessageRetention(message) !== CHAT_RETENTION_24H || !isPeerMsg(message, chatPK) || !canShowMsg(message) || !shouldShortenTtl(message.ttl, nextTtlMs)) {
                        continue;
                    }
                    const key = `${chatId}:${id}:${message.ttl?.toMillis?.() ?? ''}`;
                    if (seenTtlRef.current.has(key)) {
                        continue;
                    }
                    seenTtlRef.current.add(key);
                    keys.push(key);
                    candidates.push(message);
                }

                if (!candidates.length) {
                    return;
                }

                void chat.updateSeenTtl(chatId, candidates, nextTtlMs).catch(() => {
                    for (const key of keys) {
                        seenTtlRef.current.delete(key);
                    }
                });
            },
            [chat, chatBanned, chatPK]
        );

        const expireMessagesOnLeaveTtl = useCallback(
            (chatId, messages) => {
                if (chatBanned || !chatId || !Array.isArray(messages) || !messages.length) {
                    return [];
                }

                const nextTtlMs = onSeenMessageTtlMs();
                const candidates = [];
                const keys = [];
                for (const message of messages) {
                    const id = typeof message?.id === 'string' ? message.id.trim() : '';
                    if (!id || id.startsWith('local:') || getMessageRetention(message) !== CHAT_RETENTION_SEEN || !isPeerMsg(message, chatPK) || !canShowMsg(message) || !shouldShortenTtl(message.ttl, nextTtlMs)) {
                        continue;
                    }
                    const key = `${chatId}:leave:${id}:${message.ttl?.toMillis?.() ?? ''}`;
                    if (seenTtlRef.current.has(key)) {
                        continue;
                    }
                    seenTtlRef.current.add(key);
                    keys.push(key);
                    candidates.push(message);
                }

                if (!candidates.length) {
                    return [];
                }

                clearChatPreviewMessages(chatId, candidates);
                void chat.updateSeenTtl(chatId, candidates, nextTtlMs).catch(() => {
                    for (const key of keys) {
                        seenTtlRef.current.delete(key);
                    }
                });
                return candidates;
            },
            [chat, chatBanned, chatPK, clearChatPreviewMessages]
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

        const enqueueSendJob = useCallback(
            (peerChatPKs, job, reject) => {
                const targets = uniqueChatTargets(peerChatPKs);
                const generation = sendGenerationRef.current;
                Promise.all(targets.map((peerChatPK) => waitForPeerDelete(peerChatPK)))
                    .then(() => {
                        if (generation !== sendGenerationRef.current) {
                            const error = new Error('chat reset');
                            job.onError?.(error);
                            reject?.(error);
                            return;
                        }

                        sendQueueRef.current.push(job);
                        flushSendQueue();
                    })
                    .catch((error) => {
                        job.onError?.(error);
                        reject?.(error);
                    });
            },
            [flushSendQueue, waitForPeerDelete]
        );

        const queueSend = useCallback(
            (peerChatPK, message, run) => {
                const local = showLocalMessage(peerChatPK, message);

                return new Promise((resolve, reject) => {
                    const job = {
                        resolve,
                        reject,
                        onSuccess: () => markLocalStatus(local.chatId, local.cid, LOCAL_SENT),
                        onError: () => markLocalStatus(local.chatId, local.cid, LOCAL_FAILED),
                        run,
                    };

                    enqueueSendJob(peerChatPK, job, reject);
                });
            },
            [enqueueSendJob, markLocalStatus, showLocalMessage]
        );

        const sendMessage = useCallback(
            async (peerChatPK, message) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const sendOptions = sendOptionsForPeer(peerChatPK);
                const nextMessage = withMessageRetention(message, sendOptions.retention);
                if (isLongTxt(nextMessage)) {
                    const cid = makeSendCid(nextMessage);
                    const attachment = makeTxtFileAttachment(nextMessage);

                    if (!chatPK || !chatPrivateKey || !peerChatPK) {
                        const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, { cid, ...attachment, meta: attachment });
                        saveMedia(localCache, uploaded, attachment.data, attachment);
                        rememberCachedLocalMedia(peerChatPK, cid, uploaded);
                        return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, makeSentLongTxtMessage(chatPK, cid, uploaded, nextMessage), sendOptions);
                    }

                    const localMessage = makeLongTxtLocalMessage(chatPK, cid, attachment, nextMessage);

                    return queueSend(peerChatPK, localMessage, async () => {
                        const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, { cid, ...attachment, meta: attachment });
                        saveMedia(localCache, uploaded, attachment.data, attachment);
                        rememberCachedLocalMedia(peerChatPK, cid, uploaded);
                        await chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, makeSentLongTxtMessage(chatPK, cid, uploaded, nextMessage), sendOptions);
                    });
                }
                if (!chatPK || !chatPrivateKey || !peerChatPK) {
                    return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, nextMessage, sendOptions);
                }

                const queued = makeSendMessage(chatPK, nextMessage);

                return queueSend(peerChatPK, queued.message, async () => {
                    return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, queued.message, sendOptions);
                });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, localCache, queueSend, rememberCachedLocalMedia, sendOptionsForPeer]
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
                const baseSendOptions = sendOptionsForPeer(peerChatPK);
                const retryRetention = getMessageRetention(failedMsg, baseSendOptions.retention);
                const sendOptions = { ...baseSendOptions, retention: retryRetention };

                if (isAttachmentType(failedMsg?.t) && localData) {
                    const meta = retryAttachmentMeta(failedMsg, localUri);

                    return new Promise((resolve, reject) => {
                        const job = {
                            resolve,
                            reject,
                            onSuccess: () => markLocalStatus(chatId, cid, LOCAL_SENT),
                            onError: () => markLocalStatus(chatId, cid, LOCAL_FAILED),
                            run: async () => {
                                const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, {
                                    cid,
                                    type: failedMsg.t,
                                    data: localData,
                                    meta,
                                });
                                saveMedia(localCache, uploaded, localData, meta);
                                rememberCachedLocalMedia(peerChatPK, cid, uploaded);
                                await chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, withMessageRetention({ ...uploaded, cid, s: chatPK }, retryRetention), sendOptions);
                            },
                        };

                        enqueueSendJob(peerChatPK, job, reject);
                    });
                }

                return new Promise((resolve, reject) => {
                    const job = {
                        resolve,
                        reject,
                        onSuccess: () => markLocalStatus(chatId, cid, LOCAL_SENT),
                        onError: () => markLocalStatus(chatId, cid, LOCAL_FAILED),
                        run: async () => {
                            return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, withMessageRetention(payload, retryRetention), sendOptions);
                        },
                    };

                    enqueueSendJob(peerChatPK, job, reject);
                });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, enqueueSendJob, localCache, markLocalStatus, rememberCachedLocalMedia, sendOptionsForPeer]
        );

        const sendAttachment = useCallback(
            async (peerChatPK, attachment) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const { cid, nextAttachment, localMessage } = prepareAttachment(chatPK, attachment);
                const permanent = shouldUploadPermanentMedia(attachment);
                const stayId = permanent ? newMediaStayId() : '';
                const uploadAttachment = attachmentWithPermanence(nextAttachment, permanent, stayId);
                const sendOptions = sendOptionsForPeer(peerChatPK);
                const localPayload = withMessageRetention(localMessage, sendOptions.retention);

                if (!chatPK || !chatPrivateKey || !peerChatPK) {
                    const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, uploadAttachment);
                    if (permanent) {
                        await requireMediaSaved(chat, uploaded.p, stayId, true);
                    }
                    saveMedia(localCache, uploaded, attachment?.data, attachment);
                    rememberCachedLocalMedia(peerChatPK, cid, uploaded);
                    return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, withMessageRetention({ ...uploaded, cid, s: chatPK }, sendOptions.retention), sendOptions);
                }

                return queueSend(peerChatPK, localPayload, async () => {
                    const uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, peerChatPK, uploadAttachment);
                    if (permanent) {
                        await requireMediaSaved(chat, uploaded.p, stayId, true);
                    }
                    saveMedia(localCache, uploaded, attachment?.data, attachment);
                    rememberCachedLocalMedia(peerChatPK, cid, uploaded);
                    await chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, withMessageRetention({ ...uploaded, cid, s: chatPK }, sendOptions.retention), sendOptions);
                });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, localCache, queueSend, rememberCachedLocalMedia, sendOptionsForPeer]
        );
        const sendImage = useCallback((peerChatPK, image) => sendAttachment(peerChatPK, { ...image, type: 'img' }), [sendAttachment]);
        const sendAttachmentMany = useCallback(
            async (peerChatPKs, attachment) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }

                const targets = uniqueChatTargets(peerChatPKs);
                if (!targets.length) {
                    return [];
                }

                if (!chatPK || !chatPrivateKey) {
                    const results = [];
                    for (const peerChatPK of targets) {
                        try {
                            await sendAttachment(peerChatPK, attachment);
                            results.push({ peerChatPK, ok: true });
                        } catch (error) {
                            results.push({ peerChatPK, ok: false, error });
                        }
                    }
                    return results;
                }

                const locals = targets.map((peerChatPK) => {
                    const prepared = prepareAttachment(chatPK, attachment);
                    const permanent = shouldUploadPermanentMedia(attachment);
                    const sendOptions = sendOptionsForPeer(peerChatPK);
                    const localMessage = withMessageRetention(prepared.localMessage, sendOptions.retention);
                    const local = showLocalMessage(peerChatPK, localMessage);
                    const stayId = permanent ? newMediaStayId() : '';
                    return {
                        peerChatPK,
                        cid: prepared.cid,
                        chatId: local.chatId,
                        sendOptions,
                        permanent,
                        stayId,
                        nextAttachment: attachmentWithPermanence(prepared.nextAttachment, permanent, stayId),
                    };
                });

                return new Promise((resolve, reject) => {
                    const job = {
                        resolve,
                        reject,
                        onError: () => {
                            for (const item of locals) {
                                markLocalStatus(item.chatId, item.cid, LOCAL_FAILED);
                            }
                        },
                        run: async () => {
                            const results = [];
                            const uploads = new Map();
                            const uploadErrors = new Map();

                            for (const item of locals) {
                                const uploadKey = item.permanent ? 'permanent' : 'expiring';
                                const uploadError = uploadErrors.get(uploadKey);
                                if (uploadError) {
                                    markLocalStatus(item.chatId, item.cid, LOCAL_FAILED);
                                    results.push({ peerChatPK: item.peerChatPK, ok: false, error: uploadError });
                                    continue;
                                }

                                try {
                                    let uploaded = uploads.get(uploadKey);
                                    if (!uploaded) {
                                        uploaded = await chat.uploadAttachment(chatPK, chatPrivateKey, item.peerChatPK, item.nextAttachment);
                                        uploads.set(uploadKey, uploaded);
                                        saveMedia(localCache, uploaded, attachment?.data, attachment);
                                    }
                                    if (item.permanent) {
                                        await requireMediaSaved(chat, uploaded.p, item.stayId, true);
                                    }

                                    const sent = {
                                        ...uploaded,
                                        ...(item.permanent ? { stay: item.stayId } : {}),
                                        cid: item.cid,
                                        s: chatPK,
                                    };
                                    const sentMessage = withMessageRetention(sent, item.sendOptions.retention);
                                    rememberCachedLocalMedia(item.peerChatPK, item.cid, sentMessage);
                                    await chat.sendMessage(chatPK, chatPrivateKey, item.peerChatPK, sentMessage, item.sendOptions);
                                    markLocalStatus(item.chatId, item.cid, LOCAL_SENT);
                                    results.push({ peerChatPK: item.peerChatPK, ok: true, message: sentMessage });
                                } catch (error) {
                                    if (!uploads.has(uploadKey)) {
                                        uploadErrors.set(uploadKey, error);
                                    }
                                    markLocalStatus(item.chatId, item.cid, LOCAL_FAILED);
                                    results.push({ peerChatPK: item.peerChatPK, ok: false, error });
                                }
                            }

                            return results;
                        },
                    };

                    enqueueSendJob(targets, job, reject);
                });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, enqueueSendJob, localCache, markLocalStatus, rememberCachedLocalMedia, sendAttachment, sendOptionsForPeer, showLocalMessage]
        );
        const sendImageMany = useCallback((peerChatPKs, image) => sendAttachmentMany(peerChatPKs, { ...image, type: 'img' }), [sendAttachmentMany]);
        const shareAttachment = useCallback(
            async (peerChatPK, message) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const sendOptions = sendOptionsForPeer(peerChatPK);
                const shared = withMessageRetention(makeSharedAttachment(message), sendOptions.retention);
                if (!chatPK || !chatPrivateKey || !peerChatPK) {
                    return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, shared, sendOptions);
                }

                const queued = makeSendMessage(chatPK, shared);
                return queueSend(peerChatPK, queued.message, async () => {
                    return chat.sendMessage(chatPK, chatPrivateKey, peerChatPK, queued.message, sendOptions);
                });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, queueSend, sendOptionsForPeer]
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
        const sendReaction = useCallback(
            (peerChatPK, target, emoji) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                return chat.sendReaction(chatPK, chatPrivateKey, peerChatPK, target, emoji, sendOptionsForPeer(peerChatPK));
            },
            [chat, chatBanned, chatPK, chatPrivateKey, sendOptionsForPeer]
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
        const setChatTtl = useCallback(
            (chatId, retention) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const peerChatPK = getPeerChatPKFromChatId(chatId, chatPK);
                if (!chatPK || !chatPrivateKey || !peerChatPK) {
                    throw makeChatUnavailableError();
                }
                const nextRetention = cleanChatRetention(retention);
                return chat.setChatTtl(chatId, chatPK, chatPrivateKey, peerChatPK, nextRetention).then((savedRetention) => {
                    const retentionValue = cleanChatRetention(savedRetention);
                    const patchChat = (chatItem) => {
                        const settings = normalizeChatSettings(chatItem?.settings);
                        if (chatItem?.id !== chatId || settings.retention === retentionValue) {
                            return chatItem;
                        }
                        return { ...chatItem, settings: { ...settings, retention: retentionValue } };
                    };

                    lastServerChatsRef.current = lastServerChatsRef.current.map(patchChat);
                    writeCachedChats(localCache, filterPendingDeleteChats(lastServerChatsRef.current, pendingDeleteIdsRef.current));
                    setChats((prev) => {
                        const next = prev.map(patchChat);
                        if (sameChats(prev, next)) {
                            return prev;
                        }
                        chatsRef.current = next;
                        return next;
                    });
                    return retentionValue;
                });
            },
            [chat, chatBanned, chatPK, chatPrivateKey, localCache]
        );
        const makeMessagePermanent = useCallback(
            async (chatId, message, peerChatPKOption) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const list = Array.isArray(message) ? message : [message];
                const peerChatPK = peerChatPKOption || getPeerChatPKFromChatId(chatId, chatPK);

                for (const item of list) {
                    if (!item?.id || item.pending || item.failed) {
                        continue;
                    }
                    if (!chatPK || !chatPrivateKey || !peerChatPK) {
                        throw makeChatUnavailableError();
                    }
                    const saveMediaRef = isAttachmentMsgType(item.t) && hasStoredFileRef(item);
                    const stayId = saveMediaRef ? mediaStay(item) : '';
                    if (saveMediaRef) {
                        await requireMediaSaved(chat, item.p, stayId, true);
                    }
                    const nextMessage = makeSavedMessagePayload(item, stayId);
                    await chat.updateMessage(chatId, item.id, chatPrivateKey, peerChatPK, nextMessage, { updateLastMsg: false });
                }

                return chat.makeMessagePermanent(chatId, list);
            },
            [chat, chatBanned, chatPK, chatPrivateKey]
        );
        const makeMessageTemporary = useCallback(
            async (chatId, message, peerChatPKOption, options = {}) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                const list = Array.isArray(message) ? message : [message];
                const peerChatPK = peerChatPKOption || getPeerChatPKFromChatId(chatId, chatPK);
                const ttlMs = Number.isFinite(options?.ttlMs) ? options.ttlMs : null;
                let updated = 0;

                for (const item of list) {
                    if (!item?.id || item.pending || item.failed) {
                        continue;
                    }
                    const updateBody = hasSavedMessagePayload(item) || (isAttachmentMsgType(item.t) && hasStoredFileRef(item));
                    if (updateBody && (!chatPK || !chatPrivateKey || !peerChatPK)) {
                        throw makeChatUnavailableError();
                    }
                    if (isAttachmentMsgType(item.t) && hasStoredFileRef(item)) {
                        const stayId = typeof item.stay === 'string' ? item.stay.trim() : '';
                        await chat.updateMessage(chatId, item.id, chatPrivateKey, peerChatPK, makeUnsavedMessagePayload(item), { updateLastMsg: false });
                        updated += await chat.makeMessageTemporary(chatId, [item], unsavedMessageTtlMs(item, ttlMs));
                        if (stayId) {
                            await requireMediaSaved(chat, item.p, stayId, false);
                        }
                        continue;
                    }

                    if (updateBody) {
                        await chat.updateMessage(chatId, item.id, chatPrivateKey, peerChatPK, makeUnsavedMessagePayload(item), { updateLastMsg: false });
                    }
                    updated += await chat.makeMessageTemporary(chatId, [item], unsavedMessageTtlMs(item, ttlMs));
                }

                return updated;
            },
            [chat, chatBanned, chatPK, chatPrivateKey]
        );
        const readMessageFile = useCallback(
            async (peerChatPK, message) => {
                if (chatBanned) {
                    throw makeChatUnavailableError();
                }
                if (isExpiredAttachmentMsg(message)) {
                    void dropCachedMedia(localCache, message).catch(() => {});
                    throw makeFileGoneError();
                }
                if (hasInvalidStoredMediaRef(message)) {
                    void dropCachedMedia(localCache, message).catch(() => {});
                    throw makeFileGoneError();
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

                try {
                    const bytes = await chat.readMessageFile(chatPK, chatPrivateKey, peerChatPK, message);
                    saveMedia(localCache, message, bytes, message);
                    return bytes;
                } catch (error) {
                    if (isFileGoneError(error)) {
                        void dropCachedMedia(localCache, message).catch(() => {});
                    }
                    throw error;
                }
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
                finishDeleteChat,
                restoreDeletedChat,
                markChatReadReceipt,
                markChatRead,
                markMessagesSeenTtl,
                expireMessagesOnLeaveTtl,
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
                selectedChatId,
                selectChat,
                dropChat,
                startDeleteChat,
                finishDeleteChat,
                restoreDeletedChat,
                markChatReadReceipt,
                markChatRead,
                markMessagesSeenTtl,
                expireMessagesOnLeaveTtl,
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
