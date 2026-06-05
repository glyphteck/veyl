'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterChatMessages, getChatPeerPK } from './ids.js';
import { keySet, addMessageKeys, messageHasKey } from './messagekeys.js';
import { MSG_BATCH_SIZE } from './messages/query.js';
import { dropMessageMedia, dropMissingFromBatch, expireMessageView, getMessagesBatch, holdCurrentLiveMessages, isMissingFromBatch, makeMessageViewSeed, messageSeedFromBatch, messageSeedFromView, removeMessagesByKeys, trimExpiredMessages } from './messages/window.js';
import { getMessageKey, getMessageOrderMs, mergeMessages } from './state.js';
import { canShowMsg, deriveMessageReactions, getDisplayMessages, getLatestOwnReadReceiptTarget, getLatestReadReceiptTarget, getSeenHiddenMessages, holdVisibleMsg, isControlMsg } from './messages.js';
import { resolveRenderableMessages } from './resolve.js';
import { VISITED_CHAT_PREFETCH_OLDER_BATCHES } from './messages/session/config.js';
import { timestampMs } from '../utils/time.js';

function isDenied(error) {
    return error?.code === 'permission-denied';
}

function latestPreviewMessage(messages) {
    for (let index = (messages?.length || 0) - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (canShowMsg(message) && !isControlMsg(message)) {
            return message;
        }
    }
    return null;
}

function previewValueKey(message) {
    return [
        getMessageKey(message),
        message?.id,
        message?.t,
        message?.c,
        message?.tx,
        message?.sys,
        message?.retention,
        timestampMs(message?.ttl, null),
        message?.pending === true ? 'pending' : '',
        message?.failed === true ? 'failed' : '',
    ].map((part) => part ?? '').join(':');
}

function batchCoversKey(batch, key) {
    if (!batch || !key) {
        return false;
    }
    if (batch.empty || batch.expiredKeys?.has?.(key) || batch.deletedKeys?.has?.(key)) {
        return true;
    }

    const ms = getMessageOrderMs({ cid: key });
    return Number.isFinite(ms) && Number.isFinite(batch.firstMs) && Number.isFinite(batch.lastMs) && ms >= batch.firstMs && ms <= batch.lastMs;
}

function mergeKeySets(...groups) {
    const keys = new Set();
    for (const group of groups) {
        for (const key of keySet(group)) {
            keys.add(key);
        }
    }
    return keys;
}

function messagePageMarker(message) {
    if (!message?.id || String(message.id).startsWith('local:') || !message?.ts) {
        return null;
    }
    return { id: message.id, ts: message.ts };
}

function firstMessagePageMarker(...groups) {
    let first = null;
    let firstMs = Infinity;
    for (const messages of groups) {
        for (const message of messages || []) {
            const marker = messagePageMarker(message);
            const ms = timestampMs(marker?.ts, null);
            if (!marker || ms == null) {
                continue;
            }
            if (ms < firstMs || (ms === firstMs && marker.id < first.id)) {
                first = marker;
                firstMs = ms;
            }
        }
    }
    return first;
}

function pageMarkerKey(marker) {
    if (!marker?.id) {
        return '';
    }
    const ms = timestampMs(marker.ts, null);
    return `${marker.id}:${Number.isFinite(ms) ? ms : ''}`;
}

export function createUseChatMessages({ useChat, useUser, useVault, appState, pageSize = MSG_BATCH_SIZE }) {
    if (typeof useChat !== 'function' || typeof useUser !== 'function' || typeof useVault !== 'function') {
        throw new Error('createUseChatMessages requires { useChat, useUser, useVault }');
    }

    return function useChatMessages(chatId) {
        const {
            chats,
            getMessages,
            ackMessages,
            hasChat,
            markChatRead,
            markChatReadReceipt,
            wasChatDeletedLocally,
            ackDeletedChat,
            isChatDataReady,
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
            readMessageFile,
            loadOlderMessages,
            watchMessageWindow,
        } = useChat();
        const { chatPK } = useUser();
        const { chatPrivateKey, localCache } = useVault();

        const peerChatPK = useMemo(() => getChatPeerPK((chats || []).find((chatItem) => chatItem?.id === chatId), chatPK), [chatId, chatPK, chats]);
        const scopeKey = `${chatId || ''}:${chatPK || ''}:${chatPrivateKey ? 'unlocked' : 'locked'}:${peerChatPK || ''}`;
        const initialSeed = messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK) ?? messageSeedFromView(getMessageView?.(scopeKey));

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
            const nextInitial = messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK) ?? messageSeedFromView(getMessageView?.(scopeKey));

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
            (removedKeys, snapshotKeys, fromMs, cidById) => {
                const explicitKeys = keySet(removedKeys);
                const currentKeys = snapshotKeys ? keySet(snapshotKeys) : null;
                const currentCidById = cidById instanceof Map ? cidById : null;
                if (!explicitKeys.size && !currentKeys && !currentCidById) {
                    return;
                }

                const deletedKeys = keySet(deletedMessageKeysRef.current);
                const deletedKeyCount = deletedKeys.size;
                for (const key of explicitKeys) {
                    deletedKeys.add(key);
                }
                const deletedKeysChanged = deletedKeys.size !== deletedKeyCount;

                const drop = (messages) => {
                    let dropped = false;
                    const next = [];
                    for (const message of messages || []) {
                        const isServerMessage = !!message?.id && !String(message.id).startsWith('local:');
                        const ms = timestampMs(message?.ts, null);
                        const inSnapshotRange = isServerMessage && Number.isFinite(ms) && Number.isFinite(fromMs) && ms >= fromMs;
                        const explicitlyRemoved = messageHasKey(message, explicitKeys);
                        const missingFromSnapshot = currentKeys && inSnapshotRange && !messageHasKey(message, currentKeys);
                        const sourceCid = currentCidById && inSnapshotRange ? currentCidById.get(message.id) : null;
                        const sourceChanged = !!(sourceCid && message?.cid && sourceCid !== message.cid);
                        if (explicitlyRemoved || missingFromSnapshot || sourceChanged) {
                            dropped = true;
                            addMessageKeys(deletedKeys, message);
                            dropMessageMedia(localCache, message);
                        } else {
                            next.push(message);
                        }
                    }
                    return { messages: dropped ? next : messages, dropped };
                };

                const olderDrop = drop(olderRef.current);
                const liveDrop = drop(liveRef.current);
                if (!deletedKeysChanged && !olderDrop.dropped && !liveDrop.dropped) {
                    return;
                }

                deletedMessageKeysRef.current = deletedKeys;
                ackMessages(chatId, [...deletedKeys]);
                if (olderDrop.dropped) {
                    olderRef.current = olderDrop.messages;
                    setOlder(olderDrop.messages);
                }
                if (liveDrop.dropped) {
                    liveRef.current = liveDrop.messages;
                    setLive(liveDrop.messages);
                }
                setServerBatch((prev) => (prev ? { ...prev, deletedKeys } : { empty: true, deletedKeys }));
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
                        ackMessages(chatId, [...deletedKeys]);
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
                        return { chatMessages, expiredKeys, resolvedMessages };
                    })
                    .then(({ chatMessages, expiredKeys, resolvedMessages }) => {
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
                        const nextLive = holdCurrentLiveMessages(prevLive, nextResolvedMessages, firstMs, nextKeys, expiredKeys, deletedKeys);

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

        const removeMessage = useCallback((id) => {
            if (!id) {
                return;
            }

            const drop = (messages) => {
                let changed = false;
                const next = [];
                for (const message of messages || []) {
                    if (message.id === id) {
                        changed = true;
                        dropMessageMedia(localCache, message);
                    } else {
                        next.push(message);
                    }
                }
                return changed ? next : messages;
            };
            setOlder((prev) => drop(prev));
            setLive((prev) => drop(prev));
        }, [localCache]);

        const stateMatchesScope = stateScope === scopeKey;
        const activeOlder = stateMatchesScope ? older : initialSeed?.older ?? [];
        const activeLive = stateMatchesScope ? live : initialSeed?.live ?? [];
        const activeHasOlder = stateMatchesScope ? hasOlder : initialSeed?.hasOlder ?? false;
        const activeReady = stateMatchesScope ? ready : initialSeed?.ready ?? !chatId;
        const activeExists = stateMatchesScope ? exists : initialSeed?.exists ?? false;
        const activeServerBatch = stateMatchesScope ? serverBatch : initialSeed?.serverBatch ?? null;
        const loadedWindowMarker = useMemo(() => (activeOlder.length ? firstMessagePageMarker(activeOlder, activeLive) : null), [activeOlder, activeLive]);
        const loadedWindowKey = useMemo(() => pageMarkerKey(loadedWindowMarker), [loadedWindowMarker]);

        const liveKeys = useMemo(() => new Set(activeLive.map(getMessageKey).filter(Boolean)), [activeLive]);
        const sourceGoneKeys = useMemo(() => mergeKeySets(activeServerBatch?.deletedKeys, deletedMessageKeysRef.current), [activeServerBatch]);
        const cleanOlder = useMemo(() => {
            if (activeServerBatch?.empty) {
                return [];
            }
            return dropMissingFromBatch(activeOlder, activeServerBatch, liveKeys);
        }, [activeOlder, activeServerBatch, liveKeys]);
        const renderLocals = useMemo(() => {
            if (!liveKeys.size && !sourceGoneKeys.size) {
                return locals;
            }
            return locals.filter((message) => {
                const key = getMessageKey(message);
                return (!key || !liveKeys.has(key)) && !messageHasKey(message, sourceGoneKeys);
            });
        }, [liveKeys, locals, sourceGoneKeys]);
        const rawMessages = useMemo(() => filterChatMessages(mergeMessages(cleanOlder, activeLive, renderLocals), chatPK, peerChatPK), [activeLive, chatPK, cleanOlder, peerChatPK, renderLocals]);
        const retainedMessages = useMemo(
            () =>
                getDisplayMessages(rawMessages, chatPK, peerChatPK, {
                    keepKeys: visibleMessageKeysRef.current,
                }),
            [chatPK, rawMessages, peerChatPK]
        );
        const messages = useMemo(() => deriveMessageReactions(retainedMessages, chatPK, peerChatPK).map(holdVisibleMsg), [chatPK, peerChatPK, retainedMessages]);

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
                ({ keys, removedKeys, cidById } = {}) => {
                    if (messageWindowKeyRef.current !== watchKey) {
                        return;
                    }
                    dropDeletedMessages(removedKeys, keys, fromMs, cidById);
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

            const visibleKeys = new Set();
            for (const message of messages || []) {
                if (canShowMsg(message) && !isControlMsg(message)) {
                    addMessageKeys(visibleKeys, message);
                }
            }
            if (visibleKeys.has(chatPreviewKey)) {
                return;
            }

            const droppedKeys = new Set([
                ...keySet(activeServerBatch?.expiredKeys),
                ...keySet(activeServerBatch?.deletedKeys),
                ...keySet(deletedMessageKeysRef.current),
                ...keySet(droppedMessageKeysRef.current),
            ]);
            if (!droppedKeys.has(chatPreviewKey) && !batchCoversKey(activeServerBatch, chatPreviewKey)) {
                return;
            }

            droppedKeys.add(chatPreviewKey);
            const replacement = latestPreviewMessage(messages);
            const replacementKey = getMessageKey(replacement) || '';
            const syncKey = `${chatId}:${chatPreviewKey}:${[...droppedKeys].sort().join('|')}:${replacementKey}`;
            if (lastPreviewDropSyncRef.current === syncKey) {
                return;
            }

            lastPreviewDropSyncRef.current = syncKey;
            syncChatPreviewDrop(chatId, droppedKeys, replacement);
        }, [activeExists, activeReady, activeServerBatch, chatId, messages, chatPreviewKey, syncChatPreviewDrop]);

        useEffect(() => {
            if (!chatId || !activeReady || !activeExists || !chatPreviewKey || typeof syncChatPreview !== 'function') {
                return;
            }

            const replacement = latestPreviewMessage(messages);
            if (!replacement || !messageHasKey(replacement, new Set([chatPreviewKey]))) {
                return;
            }

            const syncKey = `${chatId}:${chatPreviewKey}:${previewValueKey(replacement)}`;
            if (lastPreviewUpdateSyncRef.current === syncKey) {
                return;
            }

            lastPreviewUpdateSyncRef.current = syncKey;
            syncChatPreview(chatId, replacement);
        }, [activeExists, activeReady, chatId, messages, chatPreviewKey, syncChatPreview]);

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
                        const expiredMessages = getSeenHiddenMessages(current.messages, chatPK, peerChatPK);
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
