'use client';

import { useCallback, useRef } from 'react';
import { dropCachedChat } from '../../cache/localdata.js';
import { filterPendingDeleteChats, getLastChat, sameChats, sameLastChat, setLocalChats } from '../chats.js';
import { ownChatEntryId } from '../entry.js';
import { clearReadWrite } from '../read.js';
import { cleanText } from '../../utils/text.js';

export function useChatDelete({
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

    const getLinkIdForChat = useCallback(
        (chatId) => {
            if (!chatId) {
                return '';
            }
            const serverLinkId = cleanText(lastServerChatsRef.current.find((chatItem) => chatItem?.id === chatId)?.linkId);
            if (serverLinkId) {
                return serverLinkId;
            }
            const locals = localByChatRef.current.get(chatId) || [];
            return cleanText(locals.find((message) => message?.linkId)?.linkId);
        },
        [lastServerChatsRef, localByChatRef]
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

    const hideDeletingChats = useCallback(
        (chatIds, options = {}) => {
            const ids = [...new Set((chatIds || []).filter(Boolean))];
            if (!ids.length) {
                return;
            }

            for (const chatId of ids) {
                pendingDeleteIdsRef.current.add(chatId);
                locallyDeletedChatIdsRef.current.add(chatId);
                if (options?.keepSelected) {
                    keepSelectedDeletedChatIdsRef.current.add(chatId);
                } else {
                    keepSelectedDeletedChatIdsRef.current.delete(chatId);
                }
            }
            const localForRender = clearDeletedChatState(ids);
            renderVisibleChats(localForRender);
            setSelectedChat((current) => (current && ids.includes(current) && !options?.keepSelected ? null : current));
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

    const restoreDeletedChats = useCallback(
        (chatIds) => {
            const ids = [...new Set((chatIds || []).filter(Boolean))];
            if (!ids.length) {
                return;
            }

            for (const chatId of ids) {
                pendingDeleteIdsRef.current.delete(chatId);
                locallyDeletedChatIdsRef.current.delete(chatId);
                keepSelectedDeletedChatIdsRef.current.delete(chatId);
                hiddenChatPreviewKeysRef.current.delete(chatId);
                releaseDeleteWait(chatId);
            }

            renderVisibleChats(localByChatRef.current);
        },
        [hiddenChatPreviewKeysRef, localByChatRef, releaseDeleteWait, renderVisibleChats]
    );

    const confirmDeletedChats = useCallback(
        (chatIds) => {
            const ids = [...new Set((chatIds || []).filter(Boolean))];
            if (!ids.length) {
                return;
            }

            for (const chatId of ids) {
                pendingDeleteIdsRef.current.delete(chatId);
                locallyDeletedChatIdsRef.current.delete(chatId);
                keepSelectedDeletedChatIdsRef.current.delete(chatId);
                hiddenChatPreviewKeysRef.current.delete(chatId);
                releaseDeleteWait(chatId);
            }
            const idSet = new Set(ids);
            listActionsRef.current?.commitServerChats?.(lastServerChatsRef.current.filter((chatItem) => !idSet.has(chatItem?.id)), { warm: false });
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

    const dropUnavailableChat = useCallback(
        (chatId) => {
            if (!chatId) {
                return;
            }

            const entryId = uid && chatPrivateKey ? ownChatEntryId(chatPrivateKey, chatId) : '';
            if (entryId && typeof cloud?.user?.chats?.delete === 'function') {
                void cloud.user.chats.delete(uid, entryId).catch(() => {});
            }
            dropChat(chatId);
        },
        [chatPrivateKey, cloud, dropChat, uid]
    );

    const getDeleteTargets = useCallback(
        (chat) => {
            const raw = Array.isArray(chat) ? chat : [chat];
            const byId = new Map();
            for (const item of raw) {
                const chatId = cleanText(typeof item === 'string' ? item : item?.chatId || item?.id);
                if (!chatId || byId.has(chatId)) {
                    continue;
                }
                const entryId = cleanText(typeof item === 'object' ? item?.entryId : '') || (uid && chatPrivateKey ? ownChatEntryId(chatPrivateKey, chatId) : '');
                const linkId = cleanText(typeof item === 'object' ? item?.linkId : '') || getLinkIdForChat(chatId);
                byId.set(chatId, {
                    chatId,
                    ...(entryId ? { entryId } : {}),
                    ...(linkId ? { linkId } : {}),
                });
            }
            return [...byId.values()];
        },
        [chatPrivateKey, getLinkIdForChat, uid]
    );

    const deleteChat = useCallback(
        async (chat, options = {}) => {
            const targets = getDeleteTargets(chat);
            if (!targets.length) {
                return false;
            }

            const chatIds = targets.map((target) => target.chatId);
            hideDeletingChats(chatIds, options);
            try {
                await cloud.chat.delete(targets, { cleanup: options.cleanup !== false });
                confirmDeletedChats(chatIds);
            } catch (error) {
                restoreDeletedChats(chatIds);
                throw error;
            }

            return Array.isArray(chat) ? targets.length : true;
        },
        [cloud, confirmDeletedChats, getDeleteTargets, hideDeletingChats, restoreDeletedChats]
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
        dropUnavailableChat,
        wasChatDeletedLocally,
        ackDeletedChat,
        isChatPendingDelete,
    };
}
