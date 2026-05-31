'use client';

import { useCallback, useRef } from 'react';
import { getChatId } from '../../crypto/chat.js';
import { dropCachedChat } from '../../cache/localdata.js';
import { filterPendingDeleteChats, getLastChat, sameChats, sameLastChat, setLocalChats } from '../chats.js';
import { getPeerChatPKFromChatId } from '../ids.js';
import { clearReadWrite } from '../read.js';
import { uniqueSet } from '../../utils/array.js';

export function useChatDelete({
    chat,
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
    const deletingChatIdsRef = useRef(new Set());
    const finalizingDeleteIdsRef = useRef(new Set());
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

    const syncLiveDeleting = useCallback(
        (nextChatIds, deletingChatIds) => {
            const deletingChatIdsSet = uniqueSet(deletingChatIds);
            deletingChatIdsRef.current = deletingChatIdsSet;
            const liveChatIdsSet = uniqueSet([...(nextChatIds || []), ...deletingChatIdsSet]);
            if (pendingDeleteIdsRef.current.size) {
                for (const chatId of [...pendingDeleteIdsRef.current]) {
                    if (!liveChatIdsSet.has(chatId)) {
                        pendingDeleteIdsRef.current.delete(chatId);
                        releaseChatWriteWait(chatId);
                    }
                }
            }
            releaseReadyChatWriteWaits();
            return deletingChatIdsSet;
        },
        [releaseChatWriteWait, releaseReadyChatWriteWaits]
    );

    const mergeDeletingIds = useCallback((deletingChatIds) => {
        const deletingIds = uniqueSet([...deletingChatIdsRef.current, ...(deletingChatIds || [])]);
        deletingChatIdsRef.current = deletingIds;
        return deletingIds;
    }, []);

    const startDeleteChat = useCallback(
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
            releaseChatWriteWait(chatId);

            renderVisibleChats(localByChatRef.current);
        },
        [hiddenChatPreviewKeysRef, localByChatRef, releaseChatWriteWait, renderVisibleChats]
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
            listActionsRef.current?.commitServerChats?.(lastServerChatsRef.current.filter((chatItem) => chatItem?.id !== chatId), { warm: false });
            releaseChatWriteWait(chatId);
        },
        [hiddenChatPreviewKeysRef, lastServerChatsRef, listActionsRef, releaseChatWriteWait]
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
            const peerChatPK = getPeerChatPKFromChatId(chatId, chatPK);
            if (!peerChatPK) {
                return [];
            }
            return chat.collectSavedMediaStays(chatId, chatPK, chatPrivateKey, peerChatPK).catch(() => []);
        },
        [chat, chatPK, chatPrivateKey]
    );

    const deleteChat = useCallback(
        async (chatId, options = {}) => {
            if (!chatId || typeof chat?.finishDeletingChat !== 'function') {
                return false;
            }

            startDeleteChat(chatId, options);
            const savedMediaStays = await collectSavedMediaStays(chatId);
            try {
                await chat.finishDeletingChat(chatId);
                finishDeleteChat(chatId);
            } catch (error) {
                restoreDeletedChat(chatId);
                throw error;
            }

            void releaseSavedMediaStays(savedMediaStays);
            return true;
        },
        [chat, collectSavedMediaStays, finishDeleteChat, releaseSavedMediaStays, restoreDeletedChat, startDeleteChat]
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
        deletingChatIdsRef.current = new Set();
        finalizingDeleteIdsRef.current = new Set();
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
    };
}
