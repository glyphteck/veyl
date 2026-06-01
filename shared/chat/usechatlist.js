'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_LIST_CACHE_WRITE_DELAY_MS, CHAT_LIST_LIVE_COUNT, CHAT_LIST_PAGE_SIZE } from '../config.js';
import { getChatId } from '../crypto/chat.js';
import { readCachedChats, writeCachedChats } from '../cache/localdata.js';
import {
    getLatestOwnReadReceiptTarget,
    getLatestReadReceiptTarget,
} from './messages.js';
import {
    applyChatPreviewOverrides,
    applyReadCache,
    clearChatPreviewsByHiddenKeys,
    filterPendingDeleteChats,
    getLastChat,
    getPeersFromChats,
    mergeChatPreviewDrop,
    nextChatPreviewExpiryMs,
    sameChats,
    sameLastChat,
    setLocalChats,
    trimExpiredChatPreviews,
} from './chats.js';
import { collectMessageKeys } from './messagekeys.js';
import { markChatsRead } from './read.js';
import { CHAT_RETENTION_24H, normalizeChatSettings } from './ttl.js';
import { getChatRowLastMsgKey as getRowLastMsgKey } from './ids.js';
import { uniqueSet } from '../utils/array.js';
import { markDiag, markDone, markError } from '../utils/diagnostics.js';
import { timestampMs } from '../utils/time.js';

export function sortedUniqueChatRows(...groups) {
    const byId = new Map();
    for (const rows of groups) {
        for (const row of rows || []) {
            if (row?.id && !byId.has(row.id)) {
                byId.set(row.id, row);
            }
        }
    }
    return [...byId.values()].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
}

function chatRowIds(rows) {
    return (rows || []).map((chatItem) => chatItem?.id).filter(Boolean);
}

export function useChatList({
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
}) {
    const [chats, setChats] = useState([]);
    const [peers, setPeers] = useState([]);
    const [isChatDataReady, setIsChatDataReady] = useState(false);
    const [lastChat, setLastChat] = useState(null);
    const [serverChatIds, setServerChatIds] = useState([]);
    const [hasMoreChats, setHasMoreChats] = useState(false);
    const [loadingMoreChats, setLoadingMoreChats] = useState(false);
    const [chatRowLoadVersion, setChatRowLoadVersion] = useState(0);
    const peersCache = useRef([]);
    const lastPeersKey = useRef('');
    const lastServerChatIdsKey = useRef('');
    const chatCacheWriteTimerRef = useRef(null);
    const pendingChatCacheWriteRef = useRef(null);
    const listenUpdateSeqRef = useRef(0);

    useEffect(() => {
        chatsRef.current = chats;
    }, [chats, chatsRef]);

    useEffect(() => {
        serverChatIdsRef.current = serverChatIds;
    }, [serverChatIds, serverChatIdsRef]);

    const updateRenderedChats = useCallback(
        (nextChats) => {
            const filteredChats = applyChatPreviewOverrides(
                clearChatPreviewsByHiddenKeys(trimExpiredChatPreviews(nextChats, { skipChatId: selectedChatIdRef.current }), hiddenChatPreviewKeysRef.current),
                chatPreviewOverridesRef.current,
                chatPK,
                readCacheRef.current
            );
            const shownChats = setLocalChats(filterPendingDeleteChats(filteredChats, pendingDeleteIdsRef.current), localByChatRef.current);
            setChats((prev) => (sameChats(prev, shownChats) ? prev : shownChats));
            const nextLastChat = getLastChat(shownChats, chatPK);
            setLastChat((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
            return shownChats;
        },
        [chatPK, chatPreviewOverridesRef, hiddenChatPreviewKeysRef, localByChatRef, pendingDeleteIdsRef, readCacheRef, selectedChatIdRef]
    );

    const flushChatCacheWrite = useCallback(() => {
        if (chatCacheWriteTimerRef.current) {
            clearTimeout(chatCacheWriteTimerRef.current);
            chatCacheWriteTimerRef.current = null;
        }
        const pending = pendingChatCacheWriteRef.current;
        pendingChatCacheWriteRef.current = null;
        if (pending?.cache && Array.isArray(pending.rows)) {
            writeCachedChats(pending.cache, pending.rows);
        }
    }, []);

    const queueChatCacheWrite = useCallback(
        (rows) => {
            if (!localCache || !Array.isArray(rows)) {
                return;
            }
            pendingChatCacheWriteRef.current = {
                cache: localCache,
                rows: filterPendingDeleteChats(rows, pendingDeleteIdsRef.current),
            };
            if (chatCacheWriteTimerRef.current) {
                clearTimeout(chatCacheWriteTimerRef.current);
            }
            chatCacheWriteTimerRef.current = setTimeout(() => {
                flushChatCacheWrite();
            }, CHAT_LIST_CACHE_WRITE_DELAY_MS);
        },
        [flushChatCacheWrite, localCache, pendingDeleteIdsRef]
    );

    useEffect(() => () => flushChatCacheWrite(), [flushChatCacheWrite]);

    const rememberHiddenChatPreviewKeys = useCallback(
        (chatId, keys) => {
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
        },
        [hiddenChatPreviewKeysRef]
    );

    const clearChatPreviewKeys = useCallback(
        (chatId, keys, replacement = null) => {
            const remembered = rememberHiddenChatPreviewKeys(chatId, keys);
            const replaced = mergeChatPreviewDrop(chatPreviewOverridesRef.current, chatId, keys, replacement);
            const nextServerChats = applyChatPreviewOverrides(clearChatPreviewsByHiddenKeys(lastServerChatsRef.current, hiddenChatPreviewKeysRef.current), chatPreviewOverridesRef.current, chatPK, readCacheRef.current);
            if (!remembered && !replaced && nextServerChats === lastServerChatsRef.current) {
                return;
            }
            lastServerChatsRef.current = nextServerChats;
            queueChatCacheWrite(nextServerChats);
            updateRenderedChats(nextServerChats);
        },
        [chatPK, chatPreviewOverridesRef, hiddenChatPreviewKeysRef, lastServerChatsRef, queueChatCacheWrite, readCacheRef, rememberHiddenChatPreviewKeys, updateRenderedChats]
    );

    const updateServerChatIds = useCallback(
        (rows) => {
            const nextChatIds = chatRowIds(rows);
            const nextChatIdsKey = nextChatIds.join('|');
            serverChatIdsRef.current = nextChatIds;
            if (nextChatIdsKey !== lastServerChatIdsKey.current) {
                lastServerChatIdsKey.current = nextChatIdsKey;
                setServerChatIds(nextChatIds);
            }
            return nextChatIds;
        },
        [lastServerChatIdsKey, serverChatIdsRef]
    );

    const updatePeersFromRows = useCallback(
        (rows) => {
            const nextPeers = getPeersFromChats(rows, chatPK);
            const peersKey = nextPeers.sort().join('|');
            if (peersKey !== lastPeersKey.current) {
                peersCache.current = nextPeers;
                lastPeersKey.current = peersKey;
                setPeers(nextPeers);
            }
            return nextPeers;
        },
        [chatPK, lastPeersKey, peersCache]
    );

    const commitServerChats = useCallback(
        (rows, options = {}) => {
            const nextServerChats = applyChatPreviewOverrides(sortedUniqueChatRows(rows), chatPreviewOverridesRef.current, chatPK, readCacheRef.current);
            lastServerChatsRef.current = nextServerChats;
            const shownChats = updateRenderedChats(nextServerChats);
            updatePeersFromRows(nextServerChats);
            updateServerChatIds(nextServerChats);
            if (options?.writeCache !== false) {
                queueChatCacheWrite(nextServerChats);
            }
            if (options?.warm !== false) {
                warmChats(shownChats);
            }
            return shownChats;
        },
        [chatPK, chatPreviewOverridesRef, lastServerChatsRef, queueChatCacheWrite, readCacheRef, updatePeersFromRows, updateRenderedChats, updateServerChatIds, warmChats]
    );

    const resetChatList = useCallback(
        (ready = false) => {
            setIsChatDataReady((prev) => (prev === ready ? prev : ready));
            setChats((prev) => (prev.length ? [] : prev));
            setPeers((prev) => (prev.length ? [] : prev));
            setLastChat((prev) => (prev ? null : prev));
            setServerChatIds((prev) => (prev.length ? [] : prev));
            setHasMoreChats((prev) => (prev ? false : prev));
            setLoadingMoreChats((prev) => (prev ? false : prev));
            setChatRowLoadVersion((prev) => (prev ? 0 : prev));
            flushChatCacheWrite();
            peersCache.current = [];
            lastPeersKey.current = '';
            lastServerChatIdsKey.current = '';
            lastHydratedCacheKeyRef.current = '';
            lastServerChatsRef.current = [];
            chatPreviewOverridesRef.current = new Map();
            serverChatIdsRef.current = [];
            serverChatsReadyRef.current = false;
            chatPageCursorRef.current = null;
            chatPageLockedRef.current = false;
            chatHasMoreRef.current = false;
            chatLoadingMoreRef.current = false;
            chatRowLoadsRef.current = new Set();
        },
        [
            chatHasMoreRef,
            chatLoadingMoreRef,
            chatPageCursorRef,
            chatPageLockedRef,
            chatPreviewOverridesRef,
            chatRowLoadsRef,
            flushChatCacheWrite,
            lastHydratedCacheKeyRef,
            lastPeersKey,
            lastServerChatIdsKey,
            lastServerChatsRef,
            peersCache,
            serverChatIdsRef,
            serverChatsReadyRef,
        ]
    );

    const resetAllChatState = useCallback(
        (ready = false) => {
            resetExternalChatState?.();
            resetChatList(ready);
        },
        [resetChatList, resetExternalChatState]
    );

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
                queueChatCacheWrite(next);
                return next;
            });
        },
        [chatPK, lastServerChatsRef, queueChatCacheWrite, readCacheRef]
    );

    useEffect(() => {
        if (chatBanned) {
            resetAllChatState(true);
            return;
        }

        if (!chatPK || !chatPrivateKey || typeof chatPK !== 'string') {
            resetAllChatState();
            return;
        }

        const hydrateKey = localCache?.id ? `${localCache.id}:${chatPK}` : '';
        if (hydrateKey && lastHydratedCacheKeyRef.current !== hydrateKey) {
            const hydrateStartedAt = Date.now();
            markDiag(diag, 'chat.provider.cache.start', {});
            lastHydratedCacheKeyRef.current = hydrateKey;
            const cachedPayload = localCache?.read?.();
            const hasSavedChatSnapshot = Number(cachedPayload?.chatsSavedAt) > 0;
            const cachedChats = sortedUniqueChatRows(
                clearChatPreviewsByHiddenKeys(
                    trimExpiredChatPreviews(readCachedChats(localCache).filter((chatItem) => Array.isArray(chatItem?.participants) && chatItem.participants.includes(chatPK))),
                    hiddenChatPreviewKeysRef.current
                ).filter((chatItem) => !!chatItem?.ts)
            );

            markDone(diag, 'chat.provider.cache', hydrateStartedAt, {
                count: cachedChats.length,
                hasSavedChatSnapshot,
                ready: false,
            });
        }

        if (!isActive) {
            markDiag(diag, 'chat.provider.listen.skip', { reason: 'inactive' });
            return;
        }

        const listenStartedAt = Date.now();
        markDiag(diag, 'chat.provider.listen.start', { limit: CHAT_LIST_LIVE_COUNT });
        const unsubscribe = chat.listenToChats(
            chatPK,
            chatPrivateKey,
            (nextChats, _nextPeers, meta = {}) => {
                const updateStartedAt = Date.now();
                const rawNextChats = Array.isArray(nextChats) ? nextChats : [];
                const deletingChatIds = Array.isArray(meta?.deletingChatIds) ? meta.deletingChatIds.filter(Boolean) : [];
                const nextChatsWithRead = clearChatPreviewsByHiddenKeys(trimExpiredChatPreviews(applyReadCache(rawNextChats, chatPK, readCacheRef.current), { skipChatId: selectedChatIdRef.current }), hiddenChatPreviewKeysRef.current);
                const firstSnapshot = !serverChatsReadyRef.current;
                serverChatsReadyRef.current = true;
                const nextChatIds = rawNextChats.map((chatItem) => chatItem.id);
                const nextChatIdsSet = new Set(nextChatIds);
                const previousRenderedChats = chatsRef.current;
                const previousServerIds = serverChatIdsRef.current;

                if (deletingChatIds.length) {
                    clearDeletedChatState(deletingChatIds);
                }
                syncLiveDeleting(nextChatIds, deletingChatIds);

                if (!chatPageLockedRef.current) {
                    chatPageCursorRef.current = meta?.cursor ?? null;
                    chatHasMoreRef.current = !!meta?.hasMore;
                    setHasMoreChats((prev) => (prev === chatHasMoreRef.current ? prev : chatHasMoreRef.current));
                }

                const hiddenIds = uniqueSet([...deletingChatIds, ...pendingDeleteIdsRef.current]);
                const preservedChats = lastServerChatsRef.current.filter((chatItem) => chatItem?.id && !nextChatIdsSet.has(chatItem.id) && !hiddenIds.has(chatItem.id));
                const shownChats = commitServerChats(sortedUniqueChatRows(nextChatsWithRead, preservedChats));
                listenUpdateSeqRef.current += 1;
                markDiag(diag, 'chat.provider.listen.update', {
                    seq: listenUpdateSeqRef.current,
                    elapsedMs: Date.now() - updateStartedAt,
                    first: firstSnapshot,
                    rawCount: rawNextChats.length,
                    shownCount: shownChats.length,
                    previousShownCount: previousRenderedChats.length,
                    deletingCount: deletingChatIds.length,
                    hasMore: !!meta?.hasMore,
                    orderChanged: nextChatIds.length !== previousServerIds.length || nextChatIds.some((id, index) => previousServerIds[index] !== id),
                    renderedChanged: !sameChats(previousRenderedChats, shownChats),
                });
                setSelectedChat((currentId) => {
                    if (currentId && pendingDeleteIdsRef.current.has(currentId) && !keepSelectedDeletedChatIdsRef.current.has(currentId)) {
                        return null;
                    }
                    return currentId;
                });
                const nextLastChat = getLastChat(shownChats, chatPK);
                setLastChat((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
                if (firstSnapshot) {
                    markDone(diag, 'chat.provider.listen.first', listenStartedAt, {
                        rawCount: rawNextChats.length,
                        shownCount: shownChats.length,
                        deletingCount: deletingChatIds.length,
                        hasMore: !!meta?.hasMore,
                    });
                }
                setIsChatDataReady(true);
            },
            (error) => {
                markError(diag, 'chat.provider.listen', listenStartedAt, error);
                console.warn('Chat listener error', error);
                resetAllChatState();
            },
            { limitCount: CHAT_LIST_LIVE_COUNT }
        );
        return () => {
            markDiag(diag, 'chat.provider.listen.stop', { elapsedMs: Date.now() - listenStartedAt });
            unsubscribe?.();
        };
    }, [
        chat,
        chatBanned,
        chatHasMoreRef,
        chatPK,
        chatPageCursorRef,
        chatPageLockedRef,
        chatPrivateKey,
        commitServerChats,
        clearDeletedChatState,
        deletingChatIdsRef,
        diag,
        hiddenChatPreviewKeysRef,
        isActive,
        keepSelectedDeletedChatIdsRef,
        lastHydratedCacheKeyRef,
        lastServerChatsRef,
        localByChatRef,
        localCache,
        pendingDeleteIdsRef,
        readCacheRef,
        resetAllChatState,
        selectedChatIdRef,
        serverChatsReadyRef,
        setSelectedChat,
        syncLiveDeleting,
    ]);

    const loadMoreChats = useCallback(async () => {
        if (chatBanned || !chatPK || !chatPrivateKey || chatLoadingMoreRef.current || !chatHasMoreRef.current || !chatPageCursorRef.current) {
            return false;
        }

        chatLoadingMoreRef.current = true;
        setLoadingMoreChats(true);

        try {
            const page = await chat.loadMoreChats(chatPK, chatPrivateKey, chatPageCursorRef.current, CHAT_LIST_PAGE_SIZE);
            const pageDeletingIds = Array.isArray(page?.deletingChatIds) ? page.deletingChatIds.filter(Boolean) : [];
            const deletingIds = mergeDeletingIds(pageDeletingIds);

            if (pageDeletingIds.length) {
                clearDeletedChatState(pageDeletingIds);
            }

            const hiddenIds = uniqueSet([...pendingDeleteIdsRef.current, ...deletingIds]);
            const pageChats = clearChatPreviewsByHiddenKeys(
                trimExpiredChatPreviews(applyReadCache(Array.isArray(page?.chats) ? page.chats : [], chatPK, readCacheRef.current), { skipChatId: selectedChatIdRef.current }),
                hiddenChatPreviewKeysRef.current
            ).filter((chatItem) => chatItem?.id && !hiddenIds.has(chatItem.id));
            const nextServerChats = sortedUniqueChatRows(pageChats, lastServerChatsRef.current).filter((chatItem) => chatItem?.id && !hiddenIds.has(chatItem.id));
            commitServerChats(nextServerChats);

            chatPageLockedRef.current = true;
            chatPageCursorRef.current = page?.cursor ?? chatPageCursorRef.current;
            chatHasMoreRef.current = !!page?.hasMore;
            setHasMoreChats((prev) => (prev === chatHasMoreRef.current ? prev : chatHasMoreRef.current));

            return pageChats.length > 0;
        } catch (error) {
            console.warn('Chat page load error', error);
            return false;
        } finally {
            chatLoadingMoreRef.current = false;
            setLoadingMoreChats(false);
        }
    }, [
        chat,
        chatBanned,
        chatHasMoreRef,
        chatLoadingMoreRef,
        chatPK,
        chatPageCursorRef,
        chatPageLockedRef,
        chatPrivateKey,
        clearDeletedChatState,
        commitServerChats,
        deletingChatIdsRef,
        hiddenChatPreviewKeysRef,
        lastServerChatsRef,
        localCache,
        mergeDeletingIds,
        pendingDeleteIdsRef,
        readCacheRef,
        selectedChatIdRef,
    ]);

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
                queueChatCacheWrite(nextServerChats);
                updateRenderedChats(nextServerChats);
                return;
            }

            setChats((prev) => {
                const next = applyChatPreviewOverrides(clearChatPreviewsByHiddenKeys(trimExpiredChatPreviews(prev, { skipChatId: selectedChatId }), hiddenChatPreviewKeysRef.current), chatPreviewOverridesRef.current, chatPK, readCacheRef.current);
                if (sameChats(prev, next)) {
                    return prev;
                }
                const nextLastChat = getLastChat(next, chatPK);
                setLastChat((current) => (sameLastChat(current, nextLastChat) ? current : nextLastChat));
                return next;
            });
        }, delay);

        return () => clearTimeout(timeout);
    }, [chatPK, chatPreviewOverridesRef, chats, hiddenChatPreviewKeysRef, lastServerChatsRef, queueChatCacheWrite, readCacheRef, selectedChatId, updateRenderedChats]);

    const getChatRowLastMsgKey = useCallback(
        (chatId) => {
            if (!chatId) {
                return null;
            }
            const serverChat = lastServerChatsRef.current.find((chatItem) => chatItem?.id === chatId);
            if (serverChat) {
                return getRowLastMsgKey(serverChat);
            }
            return getRowLastMsgKey(chatsRef.current.find((chatItem) => chatItem?.id === chatId));
        },
        [chatsRef, lastServerChatsRef]
    );

    const getChatRetention = useCallback(
        (chatId) => {
            if (!chatId) {
                return CHAT_RETENTION_24H;
            }
            const serverChat = lastServerChatsRef.current.find((chatItem) => chatItem?.id === chatId);
            if (serverChat) {
                return normalizeChatSettings(serverChat.settings).retention;
            }
            const visibleChat = chatsRef.current.find((chatItem) => chatItem?.id === chatId);
            return normalizeChatSettings(visibleChat?.settings).retention;
        },
        [chatsRef, lastServerChatsRef]
    );

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
        [chatPK, lastServerChatsRef, serverChatIdsRef]
    );

    const sendOptionsForPeer = useCallback((peerChatPK) => ({ retention: getPeerChatRetention(peerChatPK), chatExists: hasServerChatForPeer(peerChatPK) }), [getPeerChatRetention, hasServerChatForPeer]);

    const ensureChatRow = useCallback(
        async (chatId) => {
            if (!chatId || chatBanned || !chatPK || !chatPrivateKey || pendingDeleteIdsRef.current.has(chatId) || chatRowLoadsRef.current.has(chatId)) {
                return false;
            }
            if (serverChatIdsRef.current.includes(chatId) || lastServerChatsRef.current.some((chatItem) => chatItem?.id === chatId)) {
                return true;
            }

            chatRowLoadsRef.current.add(chatId);
            setChatRowLoadVersion((prev) => prev + 1);
            try {
                const row = await chat.getChatRow?.(chatId, chatPK, chatPrivateKey);
                if (!row?.id || pendingDeleteIdsRef.current.has(row.id) || deletingChatIdsRef.current.has(row.id)) {
                    return false;
                }
                commitServerChats(sortedUniqueChatRows([row], lastServerChatsRef.current));
                return true;
            } catch (error) {
                console.warn('Chat row load error', error);
                return false;
            } finally {
                chatRowLoadsRef.current.delete(chatId);
                setChatRowLoadVersion((prev) => prev + 1);
            }
        },
        [chat, chatBanned, chatPK, chatPrivateKey, chatRowLoadsRef, commitServerChats, deletingChatIdsRef, lastServerChatsRef, pendingDeleteIdsRef, serverChatIdsRef]
    );

    const serverChatIdsSet = useMemo(() => new Set(serverChatIds), [serverChatIds]);
    const hasChatDoc = useCallback((chatId) => !!chatId && (serverChatIdsSet.has(chatId) || chatRowLoadsRef.current.has(chatId)) && !pendingDeleteIdsRef.current.has(chatId), [chatRowLoadVersion, chatRowLoadsRef, pendingDeleteIdsRef, serverChatIdsSet]);

    return {
        chats,
        setChats,
        peers,
        isChatDataReady,
        hasChats: chats.length > 0,
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
    };
}
