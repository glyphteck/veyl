'use client';

import { useCallback, useRef } from 'react';
import { dropCachedChat } from '../../cache/localdata.js';
import { filterPendingDeleteChats, getLastChat, sameChats, sameLastChat, setLocalChats } from '../chats.js';
import { getChatPeerPK } from '../ids.js';
import { clearReadWrite } from '../read.js';

export function useChatDelete({
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
    listActionsRef,
    closeMessageBatchRef,
}) {
    const pendingDeleteIdsRef = useRef(new Set());
    const pendingDeleteWaitersRef = useRef(new Map());
    const locallyDeletedChatIdsRef = useRef(new Set());
    const keepSelectedDeletedChatIdsRef = useRef(new Set());

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

    const isChatDeletePending = useCallback((chatId) => !!chatId && pendingDeleteIdsRef.current.has(chatId), []);

    const releaseDeleteWait = useCallback(
        (chatId) => {
            if (!isChatDeletePending(chatId)) {
                finishPendingDeleteWait(chatId);
            }
        },
        [finishPendingDeleteWait, isChatDeletePending]
    );

    const waitForChatDelete = useCallback(
        (chatId) => {
            if (!chatId || !isChatDeletePending(chatId)) {
                return Promise.resolve();
            }

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
        [isChatDeletePending]
    );

    const getChatIdForPeer = useCallback(
        (peerChatPK) => {
            if (!peerChatPK) {
                return null;
            }
            return lastServerChatsRef.current.find((chatItem) => chatItem?.peerChatPK === peerChatPK)?.id || null;
        },
        [lastServerChatsRef]
    );

    const getChatPeer = useCallback(
        (chatId) => {
            const chatItem = lastServerChatsRef.current.find((item) => item?.id === chatId);
            return getChatPeerPK(chatItem, chatPK);
        },
        [chatPK, lastServerChatsRef]
    );

    const waitForPeerDelete = useCallback(
        (peerChatPK) => {
            const chatId = getChatIdForPeer(peerChatPK);
            if (!chatId) {
                return Promise.resolve();
            }
            return waitForChatDelete(chatId);
        },
        [getChatIdForPeer, waitForChatDelete]
    );

    const clearDeletedChatState = useCallback(
        (chatIds) => {
            let localForRender = localByChatRef.current;
            let localChanged = false;
            for (const chatId of chatIds || []) {
                if (!chatId) {
                    continue;
                }
                dropCachedChat(localCache, chatId);
                closeMessageBatchRef.current?.(chatId);
                hiddenChatPreviewKeysRef.current.delete(chatId);
                if (localForRender.has(chatId)) {
                    if (!localChanged) {
                        localForRender = new Map(localForRender);
                    }
                    localForRender.delete(chatId);
                    localChanged = true;
                }
                readCacheRef.current.delete(chatId);
                chatPreviewOverridesRef.current.delete(chatId);
                clearReadWrite(pendingReadRef.current, chatId);
            }

            if (localChanged) {
                localByChatRef.current = localForRender;
                setLocalByChat(localForRender);
            }
            return localForRender;
        },
        [chatPreviewOverridesRef, closeMessageBatchRef, hiddenChatPreviewKeysRef, localByChatRef, localCache, pendingReadRef, readCacheRef, setLocalByChat]
    );

    const renderVisibleChats = useCallback(
        (localForRender = localByChatRef.current) => {
            const { setChats, setLastChat } = listActionsRef.current || {};
            const nextVisibleChats = setLocalChats(filterPendingDeleteChats(lastServerChatsRef.current, pendingDeleteIdsRef.current), localForRender);
            setChats?.((prev) => (sameChats(prev, nextVisibleChats) ? prev : nextVisibleChats));
            const nextLastChat = getLastChat(nextVisibleChats, chatPK);
            setLastChat?.((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
            return nextVisibleChats;
        },
        [chatPK, lastServerChatsRef, listActionsRef, localByChatRef]
    );

    const hideDeletingChat = useCallback(
        (chatId, options = {}) => {
            if (!chatId) {
                return;
            }

            pendingDeleteIdsRef.current.add(chatId);
            locallyDeletedChatIdsRef.current.add(chatId);
            if (options?.keepSelected) {
                keepSelectedDeletedChatIdsRef.current.add(chatId);
            } else {
                keepSelectedDeletedChatIdsRef.current.delete(chatId);
            }
            const localForRender = clearDeletedChatState([chatId]);
            renderVisibleChats(localForRender);
            setSelectedChat((current) => (current === chatId && !options?.keepSelected ? null : current));
        },
        [clearDeletedChatState, renderVisibleChats, setSelectedChat]
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
            releaseDeleteWait(chatId);

            renderVisibleChats(localByChatRef.current);
        },
        [hiddenChatPreviewKeysRef, localByChatRef, releaseDeleteWait, renderVisibleChats]
    );

    const confirmDeletedChat = useCallback(
        (chatId) => {
            if (!chatId) {
                return;
            }

            pendingDeleteIdsRef.current.delete(chatId);
            locallyDeletedChatIdsRef.current.delete(chatId);
            keepSelectedDeletedChatIdsRef.current.delete(chatId);
            hiddenChatPreviewKeysRef.current.delete(chatId);
            listActionsRef.current?.commitServerChats?.(lastServerChatsRef.current.filter((chatItem) => chatItem?.id !== chatId), { warm: false });
            releaseDeleteWait(chatId);
        },
        [hiddenChatPreviewKeysRef, lastServerChatsRef, listActionsRef, releaseDeleteWait]
    );

    const dropChat = useCallback(
        (chatId) => {
            if (!chatId) {
                return;
            }

            clearDeletedChatState([chatId]);
            finishPendingDeleteWait(chatId);

            const nextServerChats = lastServerChatsRef.current.filter((chatItem) => chatItem?.id !== chatId);
            listActionsRef.current?.commitServerChats?.(nextServerChats, { warm: false });
            setSelectedChat((current) => (current === chatId ? null : current));
        },
        [clearDeletedChatState, finishPendingDeleteWait, lastServerChatsRef, listActionsRef, setSelectedChat]
    );

    const releaseSavedMediaStays = useCallback(
        async (stays) => {
            if (!Array.isArray(stays) || !stays.length || typeof chat?.setMediaSaved !== 'function') {
                return;
            }

            await Promise.allSettled(stays.map((stay) => chat.setMediaSaved(stay.path, stay.stayId, stay.stayKey, false)));
        },
        [chat]
    );

    const collectSavedMediaStays = useCallback(
        async (chatId) => {
            if (!chatId || !chatPK || !chatPrivateKey || typeof chat?.collectSavedMediaStays !== 'function') {
                return [];
            }
            if (uid && typeof chat?.collectOwnerSavedMediaStays === 'function') {
                return chat.collectOwnerSavedMediaStays(uid, chatPrivateKey, chatId).catch(() => []);
            }
            const peerChatPK = getChatPeer(chatId);
            if (!peerChatPK) {
                return [];
            }
            return chat.collectSavedMediaStays(chatId, chatPK, chatPrivateKey, peerChatPK).catch(() => []);
        },
        [chat, uid, chatPK, chatPrivateKey, getChatPeer]
    );

    const deleteChat = useCallback(
        async (chatId, options = {}) => {
            if (!chatId || typeof chat?.deleteChatRemote !== 'function') {
                return false;
            }

            hideDeletingChat(chatId, options);
            const savedMediaStays = await collectSavedMediaStays(chatId);
            try {
                await chat.deleteChatRemote(chatId, uid, chatPrivateKey);
                confirmDeletedChat(chatId);
            } catch (error) {
                restoreDeletedChat(chatId);
                throw error;
            }

            void releaseSavedMediaStays(savedMediaStays);
            return true;
        },
        [chat, uid, chatPrivateKey, collectSavedMediaStays, confirmDeletedChat, hideDeletingChat, releaseSavedMediaStays, restoreDeletedChat]
    );

    const wasChatDeletedLocally = useCallback((chatId) => !!chatId && locallyDeletedChatIdsRef.current.has(chatId), []);

    const ackDeletedChat = useCallback((chatId) => {
        if (!chatId) {
            return;
        }
        locallyDeletedChatIdsRef.current.delete(chatId);
    }, []);

    const isChatPendingDelete = useCallback((chatId) => !!chatId && pendingDeleteIdsRef.current.has(chatId), []);

    const resetDeleteState = useCallback(() => {
        pendingDeleteIdsRef.current = new Set();
        for (const waiters of pendingDeleteWaitersRef.current.values()) {
            for (const resolve of waiters) {
                resolve();
            }
        }
        pendingDeleteWaitersRef.current = new Map();
        locallyDeletedChatIdsRef.current = new Set();
        keepSelectedDeletedChatIdsRef.current = new Set();
    }, []);

    return {
        pendingDeleteIdsRef,
        keepSelectedDeletedChatIdsRef,
        resetDeleteState,
        waitForPeerDelete,
        clearDeletedChatState,
        restoreDeletedChat,
        deleteChat,
        dropChat,
        wasChatDeletedLocally,
        ackDeletedChat,
        isChatPendingDelete,
    };
}
