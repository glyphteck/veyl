'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_LIST_CACHE_WRITE_DELAY_MS, CHAT_LIST_LISTENER_RETRY_MS, CHAT_LIST_LIVE_COUNT, CHAT_LIST_PAGE_SIZE } from '../config.js';
import { readCachedChats, writeCachedChats } from '../cache/localdata.js';
import {
    getLatestOwnReadReceiptTarget,
    getLatestReadReceiptTarget,
} from './messages.js';
import {
    applyChatPreviewOverrides,
    applyReadCache,
    canonicalChatVersions,
    clearChatPreviewsByHiddenKeys,
    filterPendingDeleteChats,
    getLastChat,
    getPeersFromChats,
    mergeChatPreviewDrop,
    nextChatPreviewExpiryMs,
    preserveChatTimestamps,
    replaceChatPreview,
    sameChats,
    sameLastChat,
    setLocalChats,
    trimExpiredChatPreviews,
} from './chats.js';
import { collectMessageKeys } from './messagekeys.js';
import { filterActiveUserChats, getChat, listenToChats, loadMoreChats as loadMoreChatEntries, restoreUserChats } from './list.js';
import { setChatPreview, setChatRead } from './messages/write.js';
import { markChatsRead } from './read.js';
import { CHAT_RETENTION_24H, normalizeChatSettings } from './ttl.js';
import { getChatPreviewKey as previewKey } from './ids.js';
import { markDiag, markDone, markError } from '../utils/diagnostics.js';
import { timestampMs } from '../utils/time.js';

export function sortedChats(...groups) {
    const byId = new Map();
    for (const chats of groups) {
        for (const chat of chats || []) {
            if (chat?.id && !byId.has(chat.id)) {
                byId.set(chat.id, chat);
            }
        }
    }
    return canonicalChatVersions([...byId.values()]);
}

function chatIds(chats) {
    return (chats || []).map((chatItem) => chatItem?.id).filter(Boolean);
}

function hydrateReadCache(chats, readCache) {
    if (!(readCache instanceof Map)) {
        return;
    }
    for (const chatItem of chats || []) {
        const readMs = timestampMs(chatItem?.readMs, null);
        if (!chatItem?.id || readMs == null || (readCache.get(chatItem.id) || 0) >= readMs) {
            continue;
        }
        readCache.set(chatItem.id, readMs);
    }
}

export function useChatList({
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
    hiddenChatPreviewKeysRef,
    readCacheRef,
    lastServerChatsRef,
    serverChatIdsRef,
    serverChatsReadyRef,
    chatPageAfterChatRef,
    chatPageLockedRef,
    chatHasMoreRef,
    chatLoadingMoreRef,
    chatLoadsRef,
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
    const [chatLoadVersion, setChatLoadVersion] = useState(0);
    const [listenRetrySeq, setListenRetrySeq] = useState(0);
    const peersCache = useRef([]);
    const lastPeersKey = useRef('');
    const lastServerChatIdsKey = useRef('');
    const chatCacheWriteTimerRef = useRef(null);
    const pendingChatCacheWriteRef = useRef(null);
    const listenUpdateSeqRef = useRef(0);
    const listenRetryTimerRef = useRef(null);
    const cachedRestoreChatsRef = useRef([]);
    const cachedRestoreReadyRef = useRef(false);

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
            const shownChats = preserveChatTimestamps(sortedChats(setLocalChats(filterPendingDeleteChats(filteredChats, pendingDeleteIdsRef.current), localByChatRef.current)), chatsRef.current);
            chatsRef.current = shownChats;
            setChats((prev) => (sameChats(prev, shownChats) ? prev : shownChats));
            const nextLastChat = getLastChat(shownChats, chatPK);
            setLastChat((prev) => (sameLastChat(prev, nextLastChat) ? prev : nextLastChat));
            return shownChats;
        },
        [chatPK, chatPreviewOverridesRef, chatsRef, hiddenChatPreviewKeysRef, localByChatRef, pendingDeleteIdsRef, readCacheRef, selectedChatIdRef]
    );

    const flushChatCacheWrite = useCallback(() => {
        if (chatCacheWriteTimerRef.current) {
            clearTimeout(chatCacheWriteTimerRef.current);
            chatCacheWriteTimerRef.current = null;
        }
        const pending = pendingChatCacheWriteRef.current;
        pendingChatCacheWriteRef.current = null;
        if (pending?.cache && Array.isArray(pending.chats)) {
            writeCachedChats(pending.cache, pending.chats);
        }
    }, []);

    const queueChatCacheWrite = useCallback(
        (nextChats) => {
            if (!localCache || !Array.isArray(nextChats)) {
                return;
            }
            pendingChatCacheWriteRef.current = {
                cache: localCache,
                chats: filterPendingDeleteChats(nextChats, pendingDeleteIdsRef.current),
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

    useEffect(() => () => {
        if (listenRetryTimerRef.current) {
            clearTimeout(listenRetryTimerRef.current);
            listenRetryTimerRef.current = null;
        }
    }, []);

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

    const persistChatPreview = useCallback(
        (chatId, preview) => {
            if (!uid || !chatPrivateKey) {
                return;
            }
            void setChatPreview(cloud, uid, chatPrivateKey, chatId, preview || null).catch((error) => {
                console.warn('chat preview write failed', error);
            });
        },
        [cloud, uid, chatPrivateKey]
    );

    const clearChatPreviewKeys = useCallback(
        (chatId, keys, replacement = null) => {
            const currentChat = lastServerChatsRef.current.find((chatItem) => chatItem?.id === chatId) || chatsRef.current.find((chatItem) => chatItem?.id === chatId);
            const dropCutoffMs = timestampMs(currentChat?.preview?.ts, null) ?? timestampMs(currentChat?.ts, null);
            const remembered = rememberHiddenChatPreviewKeys(chatId, keys);
            const replaced = mergeChatPreviewDrop(chatPreviewOverridesRef.current, chatId, keys, replacement, { dropCutoffMs });
            if (remembered || replaced) {
                persistChatPreview(chatId, chatPreviewOverridesRef.current.get(chatId)?.preview || null);
            }
            const nextServerChats = applyChatPreviewOverrides(clearChatPreviewsByHiddenKeys(lastServerChatsRef.current, hiddenChatPreviewKeysRef.current), chatPreviewOverridesRef.current, chatPK, readCacheRef.current);
            if (!remembered && !replaced && nextServerChats === lastServerChatsRef.current) {
                return;
            }
            lastServerChatsRef.current = nextServerChats;
            queueChatCacheWrite(nextServerChats);
            updateRenderedChats(nextServerChats);
        },
        [chatPK, chatPreviewOverridesRef, chatsRef, hiddenChatPreviewKeysRef, lastServerChatsRef, persistChatPreview, queueChatCacheWrite, readCacheRef, rememberHiddenChatPreviewKeys, updateRenderedChats]
    );

    const syncChatPreview = useCallback(
        (chatId, preview) => {
            const nextServerChats = replaceChatPreview(lastServerChatsRef.current, chatId, preview, chatPK, readCacheRef.current);
            if (nextServerChats === lastServerChatsRef.current) {
                return;
            }
            lastServerChatsRef.current = nextServerChats;
            chatPreviewOverridesRef.current.delete(chatId);
            persistChatPreview(chatId, preview || null);
            queueChatCacheWrite(nextServerChats);
            updateRenderedChats(nextServerChats);
        },
        [chatPK, chatPreviewOverridesRef, lastServerChatsRef, persistChatPreview, queueChatCacheWrite, readCacheRef, updateRenderedChats]
    );

    const updateServerChatIds = useCallback(
        (nextChats) => {
            const nextChatIds = chatIds(nextChats);
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

    const updatePeers = useCallback(
        (nextChats) => {
            const nextPeers = getPeersFromChats(nextChats, chatPK);
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
        (nextChats, options = {}) => {
            const sorted = preserveChatTimestamps(sortedChats(nextChats), lastServerChatsRef.current);
            hydrateReadCache(sorted, readCacheRef.current);
            const nextServerChats = applyChatPreviewOverrides(sorted, chatPreviewOverridesRef.current, chatPK, readCacheRef.current);
            lastServerChatsRef.current = nextServerChats;
            const shownChats = updateRenderedChats(nextServerChats);
            updatePeers(nextServerChats);
            updateServerChatIds(nextServerChats);
            if (options?.writeCache !== false) {
                queueChatCacheWrite(nextServerChats);
            }
            if (options?.warm !== false) {
                warmChats(shownChats);
            }
            return shownChats;
        },
        [chatPK, chatPreviewOverridesRef, lastServerChatsRef, queueChatCacheWrite, readCacheRef, updatePeers, updateRenderedChats, updateServerChatIds, warmChats]
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
            setChatLoadVersion((prev) => (prev ? 0 : prev));
            flushChatCacheWrite();
            peersCache.current = [];
            lastPeersKey.current = '';
            lastServerChatIdsKey.current = '';
            lastHydratedCacheKeyRef.current = '';
            lastServerChatsRef.current = [];
            chatPreviewOverridesRef.current = new Map();
            serverChatIdsRef.current = [];
            serverChatsReadyRef.current = false;
            chatPageAfterChatRef.current = null;
            chatPageLockedRef.current = false;
            chatHasMoreRef.current = false;
            chatLoadingMoreRef.current = false;
            chatLoadsRef.current = new Set();
            cachedRestoreChatsRef.current = [];
            cachedRestoreReadyRef.current = false;
        },
        [
            chatHasMoreRef,
            chatLoadingMoreRef,
            chatPageAfterChatRef,
            chatPageLockedRef,
            chatPreviewOverridesRef,
            chatLoadsRef,
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
            void setChatRead(cloud, uid, chatPrivateKey, chatId, readMs).catch((error) => {
                console.warn('chat read state write failed', error);
            });
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
        [cloud, uid, chatPK, chatPrivateKey, lastServerChatsRef, queueChatCacheWrite, readCacheRef]
    );

    useEffect(() => {
        if (chatBanned) {
            resetAllChatState(true);
            return;
        }

        if (!uid || !chatPK || !chatPrivateKey || typeof chatPK !== 'string') {
            resetAllChatState();
            return;
        }

        let cancelled = false;
        const hydrateKey = localCache?.id ? `${localCache.id}:${chatPK}` : '';
        if (hydrateKey && lastHydratedCacheKeyRef.current !== hydrateKey) {
            const hydrateStartedAt = Date.now();
            markDiag(diag, 'chat.provider.cache.start', {});
            lastHydratedCacheKeyRef.current = hydrateKey;
            cachedRestoreReadyRef.current = false;
            const cachedPayload = localCache?.read?.();
            const hasSavedChatSnapshot = Number(cachedPayload?.chatsSavedAt) > 0;
            const cachedChats = sortedChats(
                clearChatPreviewsByHiddenKeys(
                    trimExpiredChatPreviews(readCachedChats(localCache).filter((chatItem) => !!chatItem?.peerChatPK)),
                    hiddenChatPreviewKeysRef.current
                ).filter((chatItem) => !!chatItem?.ts)
            );
            cachedRestoreChatsRef.current = hasSavedChatSnapshot ? cachedChats : [];
            if (hasSavedChatSnapshot) {
                const restoreMissingCachedChats = (candidateChats, existingIds, startedAt) => {
                    if (!cachedRestoreReadyRef.current) {
                        return [];
                    }
                    const existing = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
                    const hiddenIds = pendingDeleteIdsRef.current;
                    const restoreChats = (candidateChats || []).filter((chatItem) => chatItem?.id && !existing.has(chatItem.id) && !hiddenIds.has(chatItem.id));
                    if (!restoreChats.length) {
                        return [];
                    }
                    void restoreUserChats(cloud, uid, chatPrivateKey, restoreChats)
                        .then((count) => {
                            markDone(diag, 'chat.provider.restore', startedAt, { count });
                        })
                        .catch((error) => {
                            markError(diag, 'chat.provider.restore', startedAt, error, { count: restoreChats.length });
                        });
                    return restoreChats;
                };

                void filterActiveUserChats(cloud, uid, cachedChats)
                    .then((activeCachedChats) => {
                        cachedRestoreReadyRef.current = true;
                        cachedRestoreChatsRef.current = activeCachedChats;
                        if (cancelled) {
                            return;
                        }
                        if (serverChatsReadyRef.current) {
                            const restoreStartedAt = Date.now();
                            const restoreChats = restoreMissingCachedChats(activeCachedChats, serverChatIdsRef.current, restoreStartedAt);
                            if (restoreChats.length) {
                                commitServerChats(sortedChats(lastServerChatsRef.current, restoreChats), { writeCache: false });
                            }
                            return;
                        }
                        const shownCachedChats = commitServerChats(activeCachedChats, { writeCache: false, warm: false });
                        setIsChatDataReady(true);
                        markDone(diag, 'chat.provider.cache', hydrateStartedAt, {
                            count: cachedChats.length,
                            shownCount: shownCachedChats.length,
                            hasSavedChatSnapshot,
                            ready: true,
                        });
                    })
                    .catch((error) => {
                        if (!cancelled) {
                            markError(diag, 'chat.provider.cache', hydrateStartedAt, error, { count: cachedChats.length });
                        }
                    });
            } else {
                markDone(diag, 'chat.provider.cache', hydrateStartedAt, {
                    count: cachedChats.length,
                    shownCount: 0,
                    hasSavedChatSnapshot,
                    ready: false,
                });
            }
        }

        if (!isActive) {
            markDiag(diag, 'chat.provider.listen.skip', { reason: 'inactive' });
            return () => {
                cancelled = true;
            };
        }

        const listenStartedAt = Date.now();
        markDiag(diag, 'chat.provider.listen.start', { limit: CHAT_LIST_LIVE_COUNT });
        const retryListen = (error) => {
            if (cancelled || listenRetryTimerRef.current) {
                return;
            }
            listenRetryTimerRef.current = setTimeout(() => {
                listenRetryTimerRef.current = null;
                markDiag(diag, 'chat.provider.listen.retry', { reason: error?.code || error?.message || String(error || '') });
                setListenRetrySeq((prev) => prev + 1);
            }, CHAT_LIST_LISTENER_RETRY_MS);
        };
        const unsubscribe = listenToChats(
            cloud,
            uid,
            chatPK,
            chatPrivateKey,
            (nextChats, _nextPeers, meta = {}) => {
                const updateStartedAt = Date.now();
                const rawNextChats = Array.isArray(nextChats) ? nextChats : [];
                hydrateReadCache(rawNextChats, readCacheRef.current);
                const nextChatsWithRead = clearChatPreviewsByHiddenKeys(trimExpiredChatPreviews(applyReadCache(rawNextChats, chatPK, readCacheRef.current), { skipChatId: selectedChatIdRef.current }), hiddenChatPreviewKeysRef.current);
                const firstSnapshot = !serverChatsReadyRef.current;
                serverChatsReadyRef.current = true;
                const nextChatIds = rawNextChats.map((chatItem) => chatItem.id);
                const nextChatIdsSet = new Set(nextChatIds);
                const previousRenderedChats = chatsRef.current;
                const previousServerIds = serverChatIdsRef.current;
                const restoreChats = firstSnapshot && cachedRestoreReadyRef.current && cachedRestoreChatsRef.current.length
                    ? cachedRestoreChatsRef.current.filter((chatItem) => chatItem?.id && !nextChatIdsSet.has(chatItem.id) && !pendingDeleteIdsRef.current.has(chatItem.id))
                    : [];
                if (restoreChats.length) {
                    void restoreUserChats(cloud, uid, chatPrivateKey, restoreChats)
                        .then((count) => {
                            markDone(diag, 'chat.provider.restore', updateStartedAt, { count });
                        })
                        .catch((error) => {
                            markError(diag, 'chat.provider.restore', updateStartedAt, error, { count: restoreChats.length });
                        });
                }

                if (!chatPageLockedRef.current) {
                    chatPageAfterChatRef.current = meta?.nextAfterChat ?? null;
                    chatHasMoreRef.current = !!meta?.hasMore;
                    setHasMoreChats((prev) => (prev === chatHasMoreRef.current ? prev : chatHasMoreRef.current));
                }

                const hiddenIds = pendingDeleteIdsRef.current;
                const preservePagedChats = chatPageLockedRef.current && !!meta?.hasMore;
                const preservedChats = preservePagedChats
                    ? lastServerChatsRef.current.filter((chatItem) => chatItem?.id && !nextChatIdsSet.has(chatItem.id) && !hiddenIds.has(chatItem.id))
                    : [];
                const shownChats = commitServerChats(sortedChats(nextChatsWithRead, preservedChats, restoreChats), { writeCache: !restoreChats.length });
                listenUpdateSeqRef.current += 1;
                markDiag(diag, 'chat.provider.listen.update', {
                    seq: listenUpdateSeqRef.current,
                    elapsedMs: Date.now() - updateStartedAt,
                    first: firstSnapshot,
                    rawCount: rawNextChats.length,
                    shownCount: shownChats.length,
                    previousShownCount: previousRenderedChats.length,
                    preservedCount: preservedChats.length,
                    deletingCount: pendingDeleteIdsRef.current.size,
                    hasMore: !!meta?.hasMore,
                    orderChanged: nextChatIds.length !== previousServerIds.length || nextChatIds.some((id, index) => previousServerIds[index] !== id),
                    renderedChanged: !sameChats(previousRenderedChats, shownChats),
                });
                const shownChatIds = new Set(shownChats.map((chatItem) => chatItem?.id).filter(Boolean));
                setSelectedChat((currentId) => {
                    if (!currentId) {
                        return currentId;
                    }
                    if (pendingDeleteIdsRef.current.has(currentId) && !keepSelectedDeletedChatIdsRef.current.has(currentId)) {
                        return null;
                    }
                    if (!shownChatIds.has(currentId) && !chatLoadsRef.current.has(currentId)) {
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
                        deletingCount: pendingDeleteIdsRef.current.size,
                        hasMore: !!meta?.hasMore,
                    });
                }
                setIsChatDataReady(true);
            },
            (error) => {
                markError(diag, 'chat.provider.listen', listenStartedAt, error);
                console.warn('Chat listener error', error);
                resetAllChatState();
                retryListen(error);
            },
            { limitCount: CHAT_LIST_LIVE_COUNT }
        );
        return () => {
            cancelled = true;
            markDiag(diag, 'chat.provider.listen.stop', { elapsedMs: Date.now() - listenStartedAt });
            unsubscribe?.();
        };
    }, [
        cloud,
        chatBanned,
        chatHasMoreRef,
        chatLoadsRef,
        chatPK,
        chatPageAfterChatRef,
        chatPageLockedRef,
        chatPrivateKey,
        commitServerChats,
        diag,
        hiddenChatPreviewKeysRef,
        isActive,
        keepSelectedDeletedChatIdsRef,
        lastHydratedCacheKeyRef,
        lastServerChatsRef,
        localByChatRef,
        localCache,
        listenRetrySeq,
        pendingDeleteIdsRef,
        readCacheRef,
        resetAllChatState,
        selectedChatIdRef,
        serverChatIdsRef,
        serverChatsReadyRef,
        setSelectedChat,
        uid,
    ]);

    const loadMoreChats = useCallback(async () => {
        if (chatBanned || !uid || !chatPK || !chatPrivateKey || chatLoadingMoreRef.current || !chatHasMoreRef.current || !chatPageAfterChatRef.current) {
            return false;
        }

        chatLoadingMoreRef.current = true;
        setLoadingMoreChats(true);

        try {
            const page = await loadMoreChatEntries(cloud, uid, chatPK, chatPrivateKey, chatPageAfterChatRef.current, CHAT_LIST_PAGE_SIZE);
            const hiddenIds = pendingDeleteIdsRef.current;
            const pageChats = clearChatPreviewsByHiddenKeys(
                trimExpiredChatPreviews(applyReadCache(Array.isArray(page?.chats) ? page.chats : [], chatPK, readCacheRef.current), { skipChatId: selectedChatIdRef.current }),
                hiddenChatPreviewKeysRef.current
            ).filter((chatItem) => chatItem?.id && !hiddenIds.has(chatItem.id));
            const nextServerChats = sortedChats(pageChats, lastServerChatsRef.current).filter((chatItem) => chatItem?.id && !hiddenIds.has(chatItem.id));
            commitServerChats(nextServerChats);

            chatPageLockedRef.current = true;
            chatPageAfterChatRef.current = page?.nextAfterChat ?? null;
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
        cloud,
        chatBanned,
        chatHasMoreRef,
        chatLoadingMoreRef,
        chatPK,
        chatPageAfterChatRef,
        chatPageLockedRef,
        chatPrivateKey,
        uid,
        commitServerChats,
        hiddenChatPreviewKeysRef,
        lastServerChatsRef,
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

    const getChatPreviewKey = useCallback(
        (chatId) => {
            if (!chatId) {
                return null;
            }
            const serverChat = lastServerChatsRef.current.find((chatItem) => chatItem?.id === chatId);
            if (serverChat) {
                return previewKey(serverChat);
            }
            return previewKey(chatsRef.current.find((chatItem) => chatItem?.id === chatId));
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

    const getPeerChat = useCallback(
        (peerChatPK) => {
            if (!peerChatPK) {
                return null;
            }
            return lastServerChatsRef.current.find((chatItem) => chatItem?.peerChatPK === peerChatPK) || chatsRef.current.find((chatItem) => chatItem?.peerChatPK === peerChatPK) || null;
        },
        [chatsRef, lastServerChatsRef]
    );

    const hasServerChatForPeer = useCallback(
        (peerChatPK) => {
            if (!peerChatPK) {
                return false;
            }
            return lastServerChatsRef.current.some((chatItem) => chatItem?.peerChatPK === peerChatPK);
        },
        [lastServerChatsRef]
    );

    const sendOptionsForPeer = useCallback(
        (peerChatPK) => {
            const peerChat = getPeerChat(peerChatPK);
            return {
                chatId: peerChat?.id || '',
                linkId: peerChat?.linkId || '',
                retention: normalizeChatSettings(peerChat?.settings).retention,
                chatExists: hasServerChatForPeer(peerChatPK),
                receiverUid: peerChat?.peerUid || '',
                peerActorPK: peerChat?.actors?.[peerChatPK] || '',
                ownEntry: peerChat?.entryId ? peerChat : null,
            };
        },
        [getPeerChat, hasServerChatForPeer]
    );

    const ensureChat = useCallback(
        async (chatId) => {
            if (!chatId || chatBanned || !uid || !chatPK || !chatPrivateKey || pendingDeleteIdsRef.current.has(chatId) || chatLoadsRef.current.has(chatId)) {
                return false;
            }
            if (serverChatIdsRef.current.includes(chatId) || lastServerChatsRef.current.some((chatItem) => chatItem?.id === chatId)) {
                return true;
            }

            chatLoadsRef.current.add(chatId);
            setChatLoadVersion((prev) => prev + 1);
            try {
                const loadedChat = await getChat(cloud, uid, chatId, chatPK, chatPrivateKey);
                if (!loadedChat?.id || pendingDeleteIdsRef.current.has(loadedChat.id)) {
                    return false;
                }
                commitServerChats(sortedChats([loadedChat], lastServerChatsRef.current));
                return true;
            } catch (error) {
                console.warn('Chat load error', error);
                return false;
            } finally {
                chatLoadsRef.current.delete(chatId);
                setChatLoadVersion((prev) => prev + 1);
            }
        },
        [cloud, chatBanned, chatPK, chatPrivateKey, uid, chatLoadsRef, commitServerChats, lastServerChatsRef, pendingDeleteIdsRef, serverChatIdsRef]
    );

    const serverChatIdsSet = useMemo(() => new Set(serverChatIds), [serverChatIds]);
    const hasChat = useCallback((chatId) => !!chatId && (serverChatIdsSet.has(chatId) || chatLoadsRef.current.has(chatId)) && !pendingDeleteIdsRef.current.has(chatId), [chatLoadVersion, chatLoadsRef, pendingDeleteIdsRef, serverChatIdsSet]);

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
        syncChatPreview,
        applyBatchReadReceipt,
        resetChatList,
        ensureChat,
        getChatPreviewKey,
        getChatRetention,
        sendOptionsForPeer,
        hasChat,
    };
}
