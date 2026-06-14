'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterChatMessages, getChatPeerPK } from './ids.js';
import { keySet, addMessageKeys, messageHasKey, messageKeys } from './messagekeys.js';
import { MSG_BATCH_SIZE } from './messages/query.js';
import { deriveRouteMessages, dropDeletedMessageWindow, dropMessageMedia, expireMessageView, firstMessageWindowMarker, getMessagesBatch, holdCurrentLiveMessages, isMissingFromBatch, makeMessageViewSeed, messageSeedFromBatch, messageSeedFromView, messageWindowMarkerKey, removeMessagesByKeys, selectRouteMessageState, trimExpiredMessages } from './messages/window.js';
import { getMessageKey, getMessageOrderMs, mergeMessages } from './state.js';
import { getLatestOwnReadReceiptTarget, getLatestReadReceiptTarget, getSeenHiddenMessages } from './messages.js';
import { getPreviewDropSync, getPreviewUpdateSync } from './messages/preview.js';
import { resolveRenderableMessages } from './resolve.js';
import { VISITED_CHAT_PREFETCH_OLDER_BATCHES } from './messages/batches/config.js';
import { timestampMs } from '../utils/time.js';

function isDenied(error) {
    return error?.code === 'permission-denied';
}

function hasLoadedOlderWindow(seed) {
    return !!(seed?.ready && seed.exists && (seed.older?.length || seed.olderLoaded));
}

function pickInitialMessageSeed(batchSeed, viewSeed) {
    if (batchSeed?.ready && batchSeed.exists === false) {
        return batchSeed;
    }
    if (hasLoadedOlderWindow(viewSeed)) {
        return viewSeed;
    }
    return batchSeed ?? viewSeed;
}

export function createUseChatMessages({ useChat, useUser, useVault, appState, pageSize = MSG_BATCH_SIZE }) {
    if (typeof useChat !== 'function' || typeof useUser !== 'function' || typeof useVault !== 'function') {
        throw new Error('createUseChatMessages requires { useChat, useUser, useVault }');
    }

    return function useChatMessages(chatId) {
        const {
            chats,
            getMessages,
            hasChat,
            markChatRead,
            markChatReadReceipt,
            wasChatDeletedLocally,
            ackDeletedChat,
            isChatDataReady,
            readMessageFile,
            messageBatches = {},
        } = useChat();
        const {
            ackMessages,
            ensureMessageBatch,
            releaseMessageBatch,
            expireMessageBatch,
            subscribeMessageBatch,
            getMessageBatch: getSharedMessageBatch,
            getMessageView,
            rememberMessageView,
            updateMessageView,
            retainMessageView,
            releaseMessageView,
            getChatPreviewKey,
            syncChatPreview,
            syncChatPreviewDrop,
            queueMessagePreload,
            adoptConfirmedMessages,
            loadOlderMessages,
            watchMessageWindow,
        } = messageBatches;
        const { chatPK } = useUser();
        const { chatPrivateKey, localCache } = useVault();

        const currentChat = useMemo(() => (chats || []).find((chatItem) => chatItem?.id === chatId) || null, [chatId, chats]);
        const peerChatPK = useMemo(() => getChatPeerPK(currentChat, chatPK), [chatPK, currentChat]);
        const chatPreview = currentChat?.preview || null;
        const scopeKey = `${chatId || ''}:${chatPK || ''}:${chatPrivateKey ? 'unlocked' : 'locked'}:${peerChatPK || ''}`;
        const initialSeed = pickInitialMessageSeed(
            messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK),
            messageSeedFromView(getMessageView?.(scopeKey))
        );

        const [older, setOlder] = useState(() => initialSeed?.older ?? []);
        const [live, setLive] = useState(() => initialSeed?.live ?? []);
        const [hasOlder, setHasOlder] = useState(() => initialSeed?.hasOlder ?? false);
        const [loadingOlder, setLoadingOlder] = useState(false);
        const [ready, setReady] = useState(() => initialSeed?.ready ?? !chatId);
        const [exists, setExists] = useState(() => initialSeed?.exists ?? false);
        const [isActive, setIsActive] = useState(() => !appState?.currentState || appState.currentState === 'active');
        const [serverBatch, setServerBatch] = useState(() => initialSeed?.serverBatch ?? null);
        const [stateScope, setStateScope] = useState(scopeKey);

        const olderThanRef = useRef(initialSeed?.olderThan ?? null);
        const olderLoadedRef = useRef(!!initialSeed?.olderLoaded);
        const hasOlderRef = useRef(initialSeed?.hasOlder ?? false);
        const olderRef = useRef(initialSeed?.older ?? []);
        const liveRef = useRef(initialSeed?.live ?? []);
        const loadingOlderRef = useRef(false);
        const runRef = useRef(0);
        const applyBatchRef = useRef(0);
        const droppedMessageKeysRef = useRef(new Set());
        const resolvedMessageKeysRef = useRef(new Set());
        const chatPreviewKeyRef = useRef(null);
        const localsRef = useRef([]);
        const olderPrefetchRef = useRef({ scopeKey: '', count: 0, queued: 0, exhausted: false });
        const scopeRef = useRef('');
        const leaveTtlRef = useRef(null);
        const visibleMessageKeysRef = useRef(new Set());
        const deletedMessageKeysRef = useRef(new Set());
        const lastPreviewDropSyncRef = useRef('');
        const lastPreviewUpdateSyncRef = useRef('');
        const loadedWindowMarkerRef = useRef(null);
        const messageWindowKeyRef = useRef('');

        if (scopeRef.current !== scopeKey) {
            scopeRef.current = scopeKey;
            runRef.current += 1;
            visibleMessageKeysRef.current = new Set();
            deletedMessageKeysRef.current = new Set();
            lastPreviewDropSyncRef.current = '';
            lastPreviewUpdateSyncRef.current = '';
            loadedWindowMarkerRef.current = null;
            messageWindowKeyRef.current = '';
        }
        const chatExists = !!(chatId && hasChat(chatId));
        const chatPreviewKey = chatId && typeof getChatPreviewKey === 'function' ? getChatPreviewKey(chatId) : null;
        const locals = useMemo(() => (chatId ? getMessages(chatId) : []), [chatId, getMessages]);

        useEffect(() => {
            chatPreviewKeyRef.current = chatPreviewKey;
        }, [chatPreviewKey]);

        useEffect(() => {
            localsRef.current = locals;
        }, [locals]);

        useEffect(() => {
            if (!appState?.addEventListener) {
                return;
            }

            const sub = appState.addEventListener('change', (nextState) => {
                setIsActive(nextState === 'active');
            });
            return () => sub?.remove?.();
        }, [appState]);

        useEffect(() => {
            olderRef.current = older;
        }, [older]);

        useEffect(() => {
            liveRef.current = live;
        }, [live]);

        useEffect(() => {
            runRef.current += 1;
            const nextInitial = pickInitialMessageSeed(
                messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK),
                messageSeedFromView(getMessageView?.(scopeKey))
            );

            setOlder(nextInitial?.older ?? []);
            setLive(nextInitial?.live ?? []);
            setHasOlder(nextInitial?.hasOlder ?? false);
            hasOlderRef.current = nextInitial?.hasOlder ?? false;
            setLoadingOlder(false);
            setReady(nextInitial?.ready ?? !chatId);
            setExists(nextInitial?.exists ?? false);
            setServerBatch(nextInitial?.serverBatch ?? null);
            setStateScope(scopeKey);
            olderThanRef.current = nextInitial?.olderThan ?? null;
            olderLoadedRef.current = !!nextInitial?.olderLoaded;
            olderRef.current = nextInitial?.older ?? [];
            liveRef.current = nextInitial?.live ?? [];
            loadingOlderRef.current = false;
            applyBatchRef.current += 1;
            droppedMessageKeysRef.current = new Set();
            resolvedMessageKeysRef.current = new Set();
            visibleMessageKeysRef.current = new Set();
            deletedMessageKeysRef.current = new Set();
            lastPreviewDropSyncRef.current = '';
            lastPreviewUpdateSyncRef.current = '';
            loadedWindowMarkerRef.current = null;
            messageWindowKeyRef.current = '';
            olderPrefetchRef.current = { scopeKey, count: 0, queued: 0, exhausted: false };
        }, [chatId, chatPK, chatPrivateKey, getMessageView, getSharedMessageBatch, peerChatPK, scopeKey]);

        useEffect(() => {
            hasOlderRef.current = hasOlder;
        }, [hasOlder]);

        const releaseRouteMessageBatch = useCallback(
            (leavingChatId) => {
                releaseMessageBatch?.(leavingChatId, 'route');
            },
            [releaseMessageBatch]
        );

        const dropDeletedMessages = useCallback(
            (removedKeys, snapshotKeys, fromMs, cidById, expiredKeys) => {
                const result = dropDeletedMessageWindow({
                    older: olderRef.current,
                    live: liveRef.current,
                    deletedKeys: deletedMessageKeysRef.current,
                    removedKeys,
                    expiredKeys,
                    snapshotKeys,
                    fromMs,
                    cidById,
                    keepKeys: visibleMessageKeysRef.current,
                });
                if (!result) {
                    return;
                }

                for (const message of result.droppedMessages) {
                    dropMessageMedia(localCache, message);
                }
                deletedMessageKeysRef.current = result.deletedKeys;
                ackMessages(chatId, [...result.deletedKeys], { remove: true });
                if (result.olderChanged) {
                    olderRef.current = result.older;
                    setOlder(result.older);
                }
                if (result.liveChanged) {
                    liveRef.current = result.live;
                    setLive(result.live);
                }
                setServerBatch((prev) => (prev ? { ...prev, deletedKeys: result.deletedKeys } : { empty: true, deletedKeys: result.deletedKeys }));
            },
            [ackMessages, chatId, localCache]
        );

        useEffect(() => {
            rememberMessageView?.(
                stateScope,
                makeMessageViewSeed({
                    older,
                    live,
                    hasOlder,
                    ready,
                    exists,
                    serverBatch,
                    olderThan: olderThanRef.current,
                    olderLoaded: olderLoadedRef.current,
                })
            );
        }, [exists, hasOlder, live, older, ready, rememberMessageView, serverBatch, stateScope]);

        useEffect(() => {
            if (!chatId || !chatPK || !chatPrivateKey || !peerChatPK) {
                setExists(false);
                setReady(true);
                return;
            }

            if (!chatExists) {
                if (isChatDataReady) {
                    setOlder([]);
                    setLive([]);
                    setHasOlder(false);
                    setLoadingOlder(false);
                    setExists(false);
                    setServerBatch({ empty: true });
                    setReady(true);
                    olderThanRef.current = null;
                    olderLoadedRef.current = false;
                    liveRef.current = [];
                    loadingOlderRef.current = false;
                    return;
                }

                setOlder([]);
                setLive([]);
                setHasOlder(false);
                setLoadingOlder(false);
                setExists(false);
                setServerBatch(null);
                setReady(false);
                olderThanRef.current = null;
                olderLoadedRef.current = false;
                liveRef.current = [];
                loadingOlderRef.current = false;
                return;
            }

            setExists(true);
            if (!isActive) {
                setReady(true);
                return;
            }

            // A chat may be selected before its Firestore doc exists. Wait for the
            // shared chats stream to confirm the doc is real before attaching here.
            const runId = runRef.current;
            const applyBatch = (msgBatch) => {
                if (runId !== runRef.current) {
                    return;
                }

                if (!msgBatch) {
                    return;
                }

                if (msgBatch.ready && msgBatch.exists === false) {
                    setStateScope(scopeKey);
                    setOlder([]);
                    setLive([]);
                    setHasOlder(false);
                    setExists(false);
                    setServerBatch(null);
                    setReady(true);
                    olderThanRef.current = null;
                    olderLoadedRef.current = false;
                    liveRef.current = [];
                    return;
                }

                if (!msgBatch.adoptable) {
                    if (!liveRef.current.length && !localsRef.current.length) {
                        setReady(false);
                    }
                    return;
                }

                const seq = applyBatchRef.current + 1;
                applyBatchRef.current = seq;
                const hadRenderableMessages = !!(liveRef.current.length || localsRef.current.length);
                if (!hadRenderableMessages) {
                    setReady(false);
                }

                void Promise.resolve()
                    .then(async () => {
                        const expiredKeys = keySet(msgBatch.expiredKeys);
                        const deletedKeys = keySet(deletedMessageKeysRef.current);
                        for (const key of msgBatch.deletedKeys || []) {
                            if (key) {
                                deletedKeys.add(key);
                            }
                        }
                        for (const key of expiredKeys) {
                            deletedKeys.add(key);
                        }
                        deletedMessageKeysRef.current = deletedKeys;
                        ackMessages(chatId, [...deletedKeys], { remove: true });
                        const keepKeys = new Set();
                        for (const message of liveRef.current || []) {
                            addMessageKeys(keepKeys, message);
                        }
                        const filteredMessages = removeMessagesByKeys(trimExpiredMessages(filterChatMessages(msgBatch.messages, chatPK, peerChatPK), { keepKeys, expiredKeys }), deletedKeys);
                        const chatMessages = adoptConfirmedMessages?.(chatId, filteredMessages) || filteredMessages;
                        const resolvedMessages = await resolveRenderableMessages(chatMessages, {
                            peerChatPK,
                            readMessageFile,
                            localCache,
                            droppedKeys: droppedMessageKeysRef.current,
                            resolvedKeys: resolvedMessageKeysRef.current,
                        });
                        return { chatMessages, expiredKeys, keepKeys, resolvedMessages };
                    })
                    .then(({ chatMessages, expiredKeys, keepKeys, resolvedMessages }) => {
                        if (runId !== runRef.current || seq !== applyBatchRef.current) {
                            return;
                        }

                        if (chatId && wasChatDeletedLocally?.(chatId)) {
                            ackDeletedChat?.(chatId);
                        }

                        const prevLive = liveRef.current;
                        const deletedKeys = keySet(deletedMessageKeysRef.current);
                        const nextChatMessages = removeMessagesByKeys(chatMessages, deletedKeys);
                        const nextResolvedMessages = removeMessagesByKeys(resolvedMessages, deletedKeys);
                        const firstMs = nextChatMessages.length ? getMessageOrderMs(nextChatMessages[0]) : Infinity;
                        const nextKeys = new Set(nextChatMessages.map(getMessageKey).filter(Boolean));
                        const overflow = nextChatMessages.length ? prevLive.filter((message) => !messageHasKey(message, deletedKeys) && getMessageOrderMs(message) < firstMs && !nextKeys.has(getMessageKey(message))) : [];
                        const liveBatch = getMessagesBatch(nextChatMessages, expiredKeys, deletedKeys);
                        const nextLive = holdCurrentLiveMessages(prevLive, nextResolvedMessages, firstMs, nextKeys, expiredKeys, deletedKeys, { keepKeys });

                        if (!nextChatMessages.length && !nextLive.length) {
                            setOlder([]);
                            setServerBatch({ empty: true, expiredKeys, deletedKeys });
                        } else if (liveBatch) {
                            setOlder((prev) => {
                                let changed = false;
                                const next = [];
                                for (const message of prev || []) {
                                    if (isMissingFromBatch(message, liveBatch, nextKeys)) {
                                        changed = true;
                                        dropMessageMedia(localCache, message);
                                    } else {
                                        next.push(message);
                                    }
                                }
                                return changed ? next : prev;
                            });
                            setServerBatch(liveBatch);
                        } else {
                            setServerBatch((prev) => ({ ...(prev || {}), expiredKeys, deletedKeys }));
                        }

                        if (overflow.length) {
                            setOlder((prev) => mergeMessages(prev, overflow));
                            if (!olderLoadedRef.current) {
                                olderLoadedRef.current = true;
                                olderThanRef.current = msgBatch.carry ?? msgBatch.olderThan;
                                setHasOlder(msgBatch.hasMore);
                            }
                        } else if (!olderLoadedRef.current) {
                            olderThanRef.current = msgBatch.olderThan;
                            setHasOlder(msgBatch.hasOlder);
                        }

                        liveRef.current = nextLive;
                        setStateScope(scopeKey);
                        setLive(nextLive);
                        ackMessages(chatId, nextChatMessages);
                        setExists(true);
                        setReady(true);
                    })
                    .catch((error) => {
                        if (runId === runRef.current && seq === applyBatchRef.current && !isDenied(error)) {
                            console.warn('Message batch resolve failed', chatId, error);
                        }
                        if (runId === runRef.current && seq === applyBatchRef.current) {
                            setExists(true);
                            setReady(true);
                        }
                    });
            };

            ensureMessageBatch?.(chatId, {
                source: 'route',
                peerChatPK,
                chatPreviewKey: chatPreviewKeyRef.current,
                pageSize,
            });
            applyBatch(getSharedMessageBatch?.(chatId));
            const unsubscribe = subscribeMessageBatch?.(chatId, applyBatch);
            return () => {
                unsubscribe?.();
                releaseRouteMessageBatch(chatId);
            };
        }, [
            ackDeletedChat,
            ackMessages,
            adoptConfirmedMessages,
            chatExists,
            chatId,
            chatPK,
            chatPrivateKey,
            ensureMessageBatch,
            getSharedMessageBatch,
            isActive,
            isChatDataReady,
            localCache,
            pageSize,
            peerChatPK,
            readMessageFile,
            releaseRouteMessageBatch,
            scopeKey,
            subscribeMessageBatch,
            wasChatDeletedLocally,
        ]);

        useEffect(() => {
            if (!chatId || !chatExists || !chatPK || !chatPrivateKey || !peerChatPK || !isActive) {
                return;
            }

            ensureMessageBatch?.(chatId, {
                source: 'route',
                peerChatPK,
                chatPreviewKey,
                pageSize,
            });
        }, [chatExists, chatId, chatPK, chatPrivateKey, ensureMessageBatch, isActive, pageSize, peerChatPK, chatPreviewKey]);

        const loadOlder = useCallback(async () => {
            if (stateScope !== scopeKey || !chatId || !chatExists || !chatPK || !chatPrivateKey || !peerChatPK || !hasOlderRef.current || loadingOlderRef.current || !olderThanRef.current) {
                return false;
            }

            loadingOlderRef.current = true;
            setLoadingOlder(true);
            const runId = runRef.current;
            try {
                const previousOlderThan = olderThanRef.current;
                const currentChat = (chats || []).find((chatItem) => chatItem?.id === chatId);
                const page = await loadOlderMessages(chatId, chatPK, chatPrivateKey, peerChatPK, olderThanRef.current, pageSize, { actors: currentChat?.actors });
                if (runId !== runRef.current) {
                    return false;
                }
                const olderThanChanged = !!page.nextOlderThan && page.nextOlderThan?.id !== previousOlderThan?.id;
                if (page.nextOlderThan) {
                    olderThanRef.current = page.nextOlderThan;
                }
                olderLoadedRef.current = true;
                if (page.messages.length) {
                    const pageBatch = getMessagesBatch(page.messages);
                    const pageKeys = new Set(page.messages.map(getMessageKey).filter(Boolean));
                    const resolvedMessages = await resolveRenderableMessages(page.messages, {
                        peerChatPK,
                        readMessageFile,
                        localCache,
                        droppedKeys: droppedMessageKeysRef.current,
                        resolvedKeys: resolvedMessageKeysRef.current,
                    });
                    if (runId !== runRef.current) {
                        return false;
                    }
                    setOlder((prev) => {
                        const kept = [];
                        for (const message of prev || []) {
                            if (isMissingFromBatch(message, pageBatch, pageKeys)) {
                                dropMessageMedia(localCache, message);
                            } else {
                                kept.push(message);
                            }
                        }
                        return mergeMessages(resolvedMessages, kept);
                    });
                }
                hasOlderRef.current = page.hasMore;
                setHasOlder(page.hasMore);
                return page.messages.length > 0 || olderThanChanged;
            } catch (error) {
                if (!isDenied(error)) {
                    console.warn('Older messages load failed', chatId, error);
                }
                return false;
            } finally {
                if (runId === runRef.current) {
                    loadingOlderRef.current = false;
                    setLoadingOlder(false);
                }
            }
        }, [chatExists, chatId, chatPK, chatPrivateKey, chats, loadOlderMessages, localCache, pageSize, peerChatPK, readMessageFile, scopeKey, stateScope]);

        useEffect(() => {
            if (stateScope !== scopeKey || !chatId || !ready || !exists || !hasOlder || !olderThanRef.current || typeof queueMessagePreload !== 'function') {
                return undefined;
            }

            const state = olderPrefetchRef.current;
            if (state.scopeKey !== scopeKey) {
                olderPrefetchRef.current = { scopeKey, count: 0, queued: 0, exhausted: false };
            }
            const current = olderPrefetchRef.current;
            const target = VISITED_CHAT_PREFETCH_OLDER_BATCHES;
            if (current.exhausted || current.queued >= target || current.count >= target) {
                return undefined;
            }

            const start = current.queued;
            const tasks = [];
            for (let index = start; index < target; index += 1) {
                const batchNumber = index + 1;
                tasks.push({
                    kind: 'older',
                    key: `older:${scopeKey}:${batchNumber}`,
                    async run() {
                        const active = olderPrefetchRef.current;
                        if (active.scopeKey !== scopeKey || active.exhausted || !hasOlderRef.current || !olderThanRef.current) {
                            return false;
                        }
                        if (loadingOlderRef.current) {
                            return false;
                        }

                        const loaded = await loadOlder();
                        if (olderPrefetchRef.current.scopeKey !== scopeKey) {
                            return false;
                        }

                        if (loaded) {
                            olderPrefetchRef.current.count += 1;
                        } else if (!hasOlderRef.current || !olderThanRef.current) {
                            olderPrefetchRef.current.exhausted = true;
                        }
                        return loaded;
                    },
                });
            }
            current.queued = target;
            queueMessagePreload(tasks);
            return undefined;
        }, [chatId, exists, hasOlder, loadOlder, queueMessagePreload, ready, scopeKey, stateScope]);

        const patchMessage = useCallback((id, patch) => {
            if (!id) {
                return;
            }

            const applyPatch = (messages) => messages.map((message) => (message.id === id ? { ...message, ...patch } : message));
            setOlder((prev) => applyPatch(prev));
            setLive((prev) => applyPatch(prev));
        }, []);

        const removeMessage = useCallback((target) => {
            if (!target) {
                return;
            }

            const deleteKeys = new Set(messageKeys(target));
            for (const messages of [olderRef.current, liveRef.current, localsRef.current]) {
                for (const message of messages || []) {
                    if (messageHasKey(message, deleteKeys)) {
                        addMessageKeys(deleteKeys, message);
                    }
                }
            }
            if (!deleteKeys.size) {
                return;
            }

            const nextDeletedKeys = keySet(deletedMessageKeysRef.current);
            let deletedKeysChanged = false;
            for (const key of deleteKeys) {
                if (!nextDeletedKeys.has(key)) {
                    nextDeletedKeys.add(key);
                    deletedKeysChanged = true;
                }
            }
            if (deletedKeysChanged) {
                deletedMessageKeysRef.current = nextDeletedKeys;
                ackMessages(chatId, [...nextDeletedKeys], { remove: true });
                setServerBatch((prev) => ({ ...(prev || {}), deletedKeys: nextDeletedKeys }));
            }

            const drop = (messages) => {
                let changed = false;
                const next = [];
                for (const message of messages || []) {
                    if (messageHasKey(message, deleteKeys)) {
                        changed = true;
                        dropMessageMedia(localCache, message);
                    } else {
                        next.push(message);
                    }
                }
                return changed ? next : messages;
            };
            const nextOlder = drop(olderRef.current);
            const nextLive = drop(liveRef.current);
            if (nextOlder !== olderRef.current) {
                olderRef.current = nextOlder;
                setOlder(nextOlder);
            }
            if (nextLive !== liveRef.current) {
                liveRef.current = nextLive;
                setLive(nextLive);
            }
        }, [ackMessages, chatId, localCache]);

        const activeState = selectRouteMessageState({
            stateScope,
            scopeKey,
            initialSeed,
            older,
            live,
            hasOlder,
            ready,
            exists,
            serverBatch,
            fallbackReady: !chatId,
        });
        const activeOlder = activeState.older;
        const activeLive = activeState.live;
        const activeHasOlder = activeState.hasOlder;
        const activeReady = activeState.ready;
        const activeExists = activeState.exists;
        const activeServerBatch = activeState.serverBatch;
        const loadedWindowMarker = useMemo(() => firstMessageWindowMarker(activeOlder, activeLive), [activeOlder, activeLive]);
        const loadedWindowKey = useMemo(() => messageWindowMarkerKey(loadedWindowMarker), [loadedWindowMarker]);

        const routeMessages = useMemo(
            () =>
                deriveRouteMessages({
                    older: activeOlder,
                    live: activeLive,
                    locals,
                    serverBatch: activeServerBatch,
                    deletedKeys: deletedMessageKeysRef.current,
                    visibleKeys: visibleMessageKeysRef.current,
                    chatPK,
                    peerChatPK,
                }),
            [activeOlder, activeLive, activeServerBatch, chatPK, locals, peerChatPK]
        );
        const { rawMessages, messages } = routeMessages;

        useEffect(() => {
            const keys = new Set();
            for (const message of messages || []) {
                addMessageKeys(keys, message);
            }
            visibleMessageKeysRef.current = keys;
        }, [messages]);

        useEffect(() => {
            loadedWindowMarkerRef.current = loadedWindowMarker;
        }, [loadedWindowMarker]);

        useEffect(() => {
            const loadedWindowMarker = loadedWindowMarkerRef.current;
            if (!chatId || !activeReady || !activeExists || !isActive || !loadedWindowMarker || !loadedWindowKey || typeof watchMessageWindow !== 'function') {
                messageWindowKeyRef.current = '';
                return undefined;
            }

            const watchKey = loadedWindowKey;
            const fromMs = timestampMs(loadedWindowMarker.ts, null);
            messageWindowKeyRef.current = watchKey;
            const unsubscribe = watchMessageWindow(
                chatId,
                loadedWindowMarker,
                ({ keys, removedKeys, expiredKeys, cidById } = {}) => {
                    if (messageWindowKeyRef.current !== watchKey) {
                        return;
                    }
                    dropDeletedMessages(removedKeys, keys, fromMs, cidById, expiredKeys);
                },
                (error) => {
                    if (!isDenied(error)) {
                        console.warn('Message window listener error', chatId, error);
                    }
                }
            );
            return () => {
                if (messageWindowKeyRef.current === watchKey) {
                    messageWindowKeyRef.current = '';
                }
                unsubscribe?.();
            };
        }, [activeExists, activeReady, chatId, dropDeletedMessages, isActive, loadedWindowKey, watchMessageWindow]);

        useEffect(() => {
            if (!chatId || !activeReady || !activeExists || !chatPreviewKey || typeof syncChatPreviewDrop !== 'function') {
                return;
            }

            const sync = getPreviewDropSync({
                chatId,
                chatPreviewKey,
                messages,
                serverBatch: activeServerBatch,
                deletedKeys: deletedMessageKeysRef.current,
                droppedKeys: droppedMessageKeysRef.current,
            });
            if (!sync || lastPreviewDropSyncRef.current === sync.syncKey) {
                return;
            }

            lastPreviewDropSyncRef.current = sync.syncKey;
            syncChatPreviewDrop(chatId, sync.droppedKeys, sync.replacement);
        }, [activeExists, activeReady, activeServerBatch, chatId, messages, chatPreviewKey, syncChatPreviewDrop]);

        useEffect(() => {
            if (!chatId || !activeReady || !activeExists || !chatPreviewKey || typeof syncChatPreview !== 'function') {
                return;
            }

            const sync = getPreviewUpdateSync({ chatId, chatPreviewKey, chatPreview, chatPK, messages });
            if (!sync || lastPreviewUpdateSyncRef.current === sync.syncKey) {
                return;
            }

            lastPreviewUpdateSyncRef.current = sync.syncKey;
            syncChatPreview(chatId, sync.replacement);
        }, [activeExists, activeReady, chatId, chatPK, chatPreview, messages, chatPreviewKey, syncChatPreview]);

        useEffect(() => {
            leaveTtlRef.current = {
                chatId,
                exists: activeExists,
                ready: activeReady,
                messages,
                rawMessages,
            };
        }, [activeExists, activeReady, chatId, messages, rawMessages]);

        useEffect(() => {
            if (!chatId) {
                return undefined;
            }

            const leavingChatId = chatId;
            retainMessageView?.(scopeKey);
            return () => {
                const current = leaveTtlRef.current;
                releaseMessageView?.(scopeKey, () => {
                    if (current?.chatId === leavingChatId && current.ready && current.exists && (current.messages?.length || current.rawMessages?.length)) {
                        const expirySource = current.rawMessages?.length ? current.rawMessages : current.messages;
                        const expiredMessages = getSeenHiddenMessages(expirySource, chatPK, peerChatPK);
                        if (expiredMessages.length) {
                            expireMessageView(updateMessageView, scopeKey, expiredMessages);
                            expireMessageBatch?.(leavingChatId, expiredMessages);
                        }
                    }
                });
            };
        }, [chatId, chatPK, expireMessageBatch, peerChatPK, releaseMessageView, retainMessageView, scopeKey, updateMessageView]);

        useEffect(() => {
            if (!chatId || !activeReady || !activeExists || !chatPK || !messages.length) {
                return;
            }

            const ownTarget = getLatestOwnReadReceiptTarget(messages, chatPK);
            if (ownTarget) {
                markChatRead?.(chatId, ownTarget);
            }

            const target = getLatestReadReceiptTarget(messages, chatPK);
            if (target) {
                markChatReadReceipt?.(chatId, target);
            }
        }, [activeExists, activeReady, chatId, chatPK, markChatRead, markChatReadReceipt, messages]);

        return {
            messages,
            ready: activeReady,
            exists: activeExists,
            hasOlder: activeHasOlder,
            loadingOlder,
            loadOlder,
            patchMessage,
            removeMessage,
        };
    };
}
