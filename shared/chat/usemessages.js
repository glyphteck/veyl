'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterChatMessages, getPeerChatPKFromChatId, listenToMsgDeletes, loadOlderMsgs, MSG_BATCH_SIZE } from './utils.js';
import { getMessageKey, getMessageOrderMs, mergeMessages } from './state.js';
import { dropCachedMedia } from '../localdatacache.js';
import { applyMessageRetentionTimeline, deriveMessageReactions, filterSeenMessages, getLatestOwnReadReceiptTarget, getLatestReadReceiptTarget, getSeenHiddenMessages, holdVisibleMsg, isExpiredMsg } from './messages.js';
import { resolveRenderableMessages } from './resolve.js';

const MAX_MESSAGE_VIEW_CACHE = 30;
const VISITED_CHAT_PREFETCH_OLDER_BATCHES = 2;
const activeMessageViews = new Map();

function isDenied(error) {
    return error?.code === 'permission-denied';
}

function keySet(value) {
    if (value instanceof Set) {
        return value;
    }
    return new Set(Array.isArray(value) ? value.filter(Boolean) : []);
}

function messageHasKey(message, keys) {
    if (!message || !keys?.size) {
        return false;
    }

    const key = getMessageKey(message);
    const id = typeof message.id === 'string' ? message.id.trim() : '';
    const cid = typeof message.cid === 'string' ? message.cid.trim() : '';
    return !!((key && keys.has(key)) || (id && keys.has(id)) || (cid && keys.has(cid)));
}

function addMessageKeys(keys, message) {
    if (!keys || !message) {
        return;
    }

    const key = getMessageKey(message);
    const id = typeof message.id === 'string' ? message.id.trim() : '';
    const cid = typeof message.cid === 'string' ? message.cid.trim() : '';
    if (key) {
        keys.add(key);
    }
    if (id) {
        keys.add(id);
    }
    if (cid) {
        keys.add(cid);
    }
}

function trimExpiredMessages(messages, options = {}) {
    const keepKeys = options.keepKeys;
    const expiredKeys = options.expiredKeys;
    return (messages || []).filter((message) => {
        if (!isExpiredMsg(message)) {
            return true;
        }
        if (messageHasKey(message, keepKeys)) {
            addMessageKeys(expiredKeys, message);
        }
        return false;
    });
}

function getMessagesBatch(messages, expiredKeys) {
    if (!messages?.length) {
        return null;
    }

    const firstMs = getMessageOrderMs(messages[0]);
    const lastMs = getMessageOrderMs(messages[messages.length - 1]);
    if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) {
        return null;
    }
    return { firstMs, lastMs, expiredKeys: keySet(expiredKeys) };
}

function isMissingFromBatch(message, msgBatch, keys) {
    if (!msgBatch || !message) {
        return false;
    }
    if (messageHasKey(message, msgBatch.expiredKeys)) {
        return false;
    }

    const key = getMessageKey(message);
    if (!key || keys.has(key)) {
        return false;
    }

    const ms = getMessageOrderMs(message);
    return Number.isFinite(ms) && ms >= msgBatch.firstMs && ms <= msgBatch.lastMs;
}

function dropMissingFromBatch(messages, msgBatch, keys) {
    if (!msgBatch) {
        return messages || [];
    }
    return (messages || []).filter((message) => !isMissingFromBatch(message, msgBatch, keys));
}

function removeMessagesByKeys(messages, keys) {
    if (!keys?.size) {
        return messages || [];
    }
    return (messages || []).filter((message) => !messageHasKey(message, keys));
}

function expireMessageViewCache(cache, scopeKey, messages) {
    const seed = cache?.get?.(scopeKey);
    if (!seed?.ready || !messages?.length) {
        return;
    }

    const keys = new Set();
    const expiredKeys = keySet(seed.serverBatch?.expiredKeys);
    for (const message of messages) {
        addMessageKeys(keys, message);
        addMessageKeys(expiredKeys, message);
    }
    if (!keys.size) {
        return;
    }

    const older = removeMessagesByKeys(seed.older, keys);
    const live = removeMessagesByKeys(seed.live, keys);
    cache.set(scopeKey, {
        ...seed,
        older,
        live,
        serverBatch: live.length ? getMessagesBatch(live, expiredKeys) : seed.serverBatch?.empty ? { empty: true, expiredKeys } : { ...(seed.serverBatch || {}), expiredKeys },
    });
}

function holdCurrentLiveMessages(previous, next, firstMs, nextKeys, expiredKeys, deletedKeys) {
    const current = next || [];
    if (!previous?.length) {
        return current;
    }

    const held = [];
    for (const message of previous) {
        const key = getMessageKey(message);
        const ms = getMessageOrderMs(message);
        if (!key || nextKeys.has(key)) {
            continue;
        }
        if (messageHasKey(message, deletedKeys)) {
            continue;
        }
        if (messageHasKey(message, expiredKeys)) {
            held.push(holdVisibleMsg(message));
            continue;
        }
        if (current.length && Number.isFinite(ms) && ms >= firstMs) {
            held.push(message);
        }
    }
    return held.length ? mergeMessages(current, held) : current;
}

function retainMessageView(scopeKey) {
    if (!scopeKey) {
        return;
    }

    activeMessageViews.set(scopeKey, (activeMessageViews.get(scopeKey) || 0) + 1);
}

function releaseMessageView(scopeKey, onLeave) {
    if (!scopeKey) {
        return;
    }

    const count = (activeMessageViews.get(scopeKey) || 1) - 1;
    if (count > 0) {
        activeMessageViews.set(scopeKey, count);
        return;
    }

    activeMessageViews.delete(scopeKey);
    onLeave?.();
}

function dropMessageMedia(cache, message) {
    if (!cache || !message?.p || !message?.k) {
        return;
    }
    void dropCachedMedia(cache, message).catch(() => {});
}

function messageSeedFromBatch(msgBatch, chatPK, peerChatPK) {
    if (!msgBatch) {
        return null;
    }

    if (msgBatch.ready && msgBatch.exists === false) {
        return {
            older: [],
            live: [],
            hasOlder: false,
            ready: true,
            exists: false,
            serverBatch: null,
            oldest: null,
            olderLoaded: false,
        };
    }

    if (!msgBatch.adoptable) {
        return null;
    }

    const live = trimExpiredMessages(filterChatMessages(msgBatch.messages, chatPK, peerChatPK));
    const expiredKeys = keySet(msgBatch.expiredKeys);
    return {
        older: [],
        live,
        hasOlder: msgBatch.hasOlder,
        ready: true,
        exists: true,
        serverBatch: live.length ? getMessagesBatch(live, expiredKeys) : { empty: true, expiredKeys },
        oldest: msgBatch.cursor,
        olderLoaded: false,
    };
}

function messageSeedFromViewCache(cache, scopeKey) {
    const seed = cache?.get?.(scopeKey);
    if (!seed?.ready) {
        return null;
    }

    const older = trimExpiredMessages(seed.older || []);
    const live = trimExpiredMessages(seed.live || []);
    const expiredKeys = keySet(seed.serverBatch?.expiredKeys);

    return {
        older,
        live,
        hasOlder: !!seed.hasOlder,
        ready: true,
        exists: !!seed.exists,
        serverBatch: live.length ? getMessagesBatch(live, expiredKeys) : seed.serverBatch?.empty ? { empty: true, expiredKeys } : null,
        oldest: seed.oldest ?? null,
        olderLoaded: !!seed.olderLoaded,
    };
}

function rememberMessageView(cache, scopeKey, seed) {
    if (!cache || !scopeKey || !seed?.ready) {
        return;
    }

    cache.delete(scopeKey);
    cache.set(scopeKey, {
        older: seed.older || [],
        live: seed.live || [],
        hasOlder: !!seed.hasOlder,
        ready: true,
        exists: !!seed.exists,
        serverBatch: seed.serverBatch ?? null,
        oldest: seed.oldest ?? null,
        olderLoaded: !!seed.olderLoaded,
    });

    while (cache.size > MAX_MESSAGE_VIEW_CACHE) {
        const oldest = cache.keys().next().value;
        if (!oldest) {
            return;
        }
        cache.delete(oldest);
    }
}

export function createUseChatMessages({ db, useChat, useUser, useVault, appState, pageSize = MSG_BATCH_SIZE }) {
    if (!db) {
        throw new Error('createUseChatMessages requires db');
    }
    if (typeof useChat !== 'function' || typeof useUser !== 'function' || typeof useVault !== 'function') {
        throw new Error('createUseChatMessages requires { useChat, useUser, useVault }');
    }

    return function useChatMessages(chatId) {
        const {
            getMessages,
            ackMessages,
            hasChatDoc,
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
            getChatRowLastMsgKey,
            queueMessagePreload,
            adoptConfirmedMessages,
            readMessageFile,
        } = useChat();
        const { chatPK } = useUser();
        const { chatPrivateKey, localCache } = useVault();

        const peerChatPK = useMemo(() => getPeerChatPKFromChatId(chatId, chatPK), [chatId, chatPK]);
        const scopeKey = `${chatId || ''}:${chatPK || ''}:${chatPrivateKey ? 'unlocked' : 'locked'}:${peerChatPK || ''}`;
        const viewCacheRef = useRef(new Map());
        const initialSeed = messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK) ?? messageSeedFromViewCache(viewCacheRef.current, scopeKey);

        const [older, setOlder] = useState(() => initialSeed?.older ?? []);
        const [live, setLive] = useState(() => initialSeed?.live ?? []);
        const [hasOlder, setHasOlder] = useState(() => initialSeed?.hasOlder ?? false);
        const [loadingOlder, setLoadingOlder] = useState(false);
        const [ready, setReady] = useState(() => initialSeed?.ready ?? !chatId);
        const [exists, setExists] = useState(() => initialSeed?.exists ?? false);
        const [isActive, setIsActive] = useState(() => !appState?.currentState || appState.currentState === 'active');
        const [serverBatch, setServerBatch] = useState(() => initialSeed?.serverBatch ?? null);
        const [stateScope, setStateScope] = useState(scopeKey);

        const oldestRef = useRef(initialSeed?.oldest ?? null);
        const olderLoadedRef = useRef(!!initialSeed?.olderLoaded);
        const hasOlderRef = useRef(initialSeed?.hasOlder ?? false);
        const liveRef = useRef(initialSeed?.live ?? []);
        const loadingOlderRef = useRef(false);
        const runRef = useRef(0);
        const applyBatchRef = useRef(0);
        const droppedMessageKeysRef = useRef(new Set());
        const resolvedMessageKeysRef = useRef(new Set());
        const rowLastMsgKeyRef = useRef(null);
        const localsRef = useRef([]);
        const olderPrefetchRef = useRef({ scopeKey: '', count: 0, queued: 0, exhausted: false });
        const scopeRef = useRef('');
        const leaveTtlRef = useRef(null);
        const visibleMessageKeysRef = useRef(new Set());
        const deletedMessageKeysRef = useRef(new Set());

        if (scopeRef.current !== scopeKey) {
            scopeRef.current = scopeKey;
            runRef.current += 1;
            visibleMessageKeysRef.current = new Set();
            deletedMessageKeysRef.current = new Set();
        }
        const chatExists = !!(chatId && hasChatDoc(chatId));
        const rowLastMsgKey = chatId && typeof getChatRowLastMsgKey === 'function' ? getChatRowLastMsgKey(chatId) : null;
        const locals = useMemo(() => (chatId ? getMessages(chatId) : []), [chatId, getMessages]);

        useEffect(() => {
            rowLastMsgKeyRef.current = rowLastMsgKey;
        }, [rowLastMsgKey]);

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
            liveRef.current = live;
        }, [live]);

        useEffect(() => {
            runRef.current += 1;
            const nextInitial = messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK) ?? messageSeedFromViewCache(viewCacheRef.current, scopeKey);

            setOlder(nextInitial?.older ?? []);
            setLive(nextInitial?.live ?? []);
            setHasOlder(nextInitial?.hasOlder ?? false);
            hasOlderRef.current = nextInitial?.hasOlder ?? false;
            setLoadingOlder(false);
            setReady(nextInitial?.ready ?? !chatId);
            setExists(nextInitial?.exists ?? false);
            setServerBatch(nextInitial?.serverBatch ?? null);
            setStateScope(scopeKey);
            oldestRef.current = nextInitial?.oldest ?? null;
            olderLoadedRef.current = !!nextInitial?.olderLoaded;
            liveRef.current = nextInitial?.live ?? [];
            loadingOlderRef.current = false;
            applyBatchRef.current += 1;
            droppedMessageKeysRef.current = new Set();
            resolvedMessageKeysRef.current = new Set();
            visibleMessageKeysRef.current = new Set();
            deletedMessageKeysRef.current = new Set();
            olderPrefetchRef.current = { scopeKey, count: 0, queued: 0, exhausted: false };
        }, [chatId, chatPK, chatPrivateKey, getSharedMessageBatch, peerChatPK, scopeKey]);

        useEffect(() => {
            hasOlderRef.current = hasOlder;
        }, [hasOlder]);

        useEffect(() => {
            rememberMessageView(viewCacheRef.current, stateScope, {
                older,
                live,
                hasOlder,
                ready,
                exists,
                serverBatch,
                oldest: oldestRef.current,
                olderLoaded: olderLoadedRef.current,
            });
        }, [exists, hasOlder, live, older, ready, serverBatch, stateScope]);

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
                    oldestRef.current = null;
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
                oldestRef.current = null;
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
                    oldestRef.current = null;
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
                        const keepKeys = new Set();
                        for (const message of liveRef.current || []) {
                            addMessageKeys(keepKeys, message);
                        }
                        const filteredMessages = removeMessagesByKeys(trimExpiredMessages(filterChatMessages(msgBatch.messages, chatPK, peerChatPK), { keepKeys, expiredKeys }), deletedMessageKeysRef.current);
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
                        const liveBatch = getMessagesBatch(nextChatMessages, expiredKeys);
                        const nextLive = holdCurrentLiveMessages(prevLive, nextResolvedMessages, firstMs, nextKeys, expiredKeys, deletedKeys);

                        if (!nextChatMessages.length && !nextLive.length) {
                            setOlder([]);
                            setServerBatch({ empty: true });
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
                                oldestRef.current = msgBatch.carry ?? msgBatch.cursor;
                                setHasOlder(msgBatch.hasMore);
                            }
                        } else if (!olderLoadedRef.current) {
                            oldestRef.current = msgBatch.cursor;
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
                rowLastMsgKey: rowLastMsgKeyRef.current,
                pageSize,
            });
            applyBatch(getSharedMessageBatch?.(chatId));
            const unsubscribe = subscribeMessageBatch?.(chatId, applyBatch);
            return () => {
                unsubscribe?.();
                releaseMessageBatch?.(chatId, 'route');
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
            releaseMessageBatch,
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
                rowLastMsgKey,
                pageSize,
            });
        }, [chatExists, chatId, chatPK, chatPrivateKey, ensureMessageBatch, isActive, pageSize, peerChatPK, rowLastMsgKey]);

        useEffect(() => {
            if (!chatId || !chatExists || !isActive) {
                return;
            }

            const runId = runRef.current;
            return listenToMsgDeletes(
                db,
                chatId,
                (removed) => {
                    if (runId !== runRef.current) {
                        return;
                    }
                    if (!removed?.length) {
                        return;
                    }

                    const removedIds = new Set(removed.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean));
                    for (const id of removedIds) {
                        deletedMessageKeysRef.current.add(id);
                    }
                    const drop = (messages) => {
                        let changed = false;
                        const next = [];
                        for (const message of messages || []) {
                            if (messageHasKey(message, removedIds)) {
                                changed = true;
                                dropMessageMedia(localCache, message);
                            } else {
                                next.push(message);
                            }
                        }
                        return changed ? next : messages;
                    };
                    setOlder((prev) => drop(prev));
                    setLive((prev) => {
                        const next = drop(prev);
                        liveRef.current = next;
                        return next;
                    });
                },
                (error) => {
                    if (runId !== runRef.current) {
                        return;
                    }
                    if (!isDenied(error)) {
                        console.warn('Message delete listener error', chatId, error);
                    }
                }
            );
        }, [chatExists, chatId, db, isActive, localCache]);

        const loadOlder = useCallback(async () => {
            if (stateScope !== scopeKey || !chatId || !chatExists || !chatPK || !chatPrivateKey || !peerChatPK || !hasOlderRef.current || loadingOlderRef.current || !oldestRef.current) {
                return false;
            }

            loadingOlderRef.current = true;
            setLoadingOlder(true);
            const runId = runRef.current;
            try {
                const previousCursor = oldestRef.current;
                const page = await loadOlderMsgs(db, chatId, chatPK, chatPrivateKey, peerChatPK, oldestRef.current, pageSize);
                if (runId !== runRef.current) {
                    return false;
                }
                const cursorChanged = !!page.cursor && page.cursor?.id !== previousCursor?.id;
                if (page.cursor) {
                    oldestRef.current = page.cursor;
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
                return page.messages.length > 0 || cursorChanged;
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
        }, [chatExists, chatId, chatPK, chatPrivateKey, db, localCache, pageSize, peerChatPK, readMessageFile, scopeKey, stateScope]);

        useEffect(() => {
            if (stateScope !== scopeKey || !chatId || !ready || !exists || !hasOlder || !oldestRef.current || typeof queueMessagePreload !== 'function') {
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
                        if (active.scopeKey !== scopeKey || active.exhausted || !hasOlderRef.current || !oldestRef.current) {
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
                        } else if (!hasOlderRef.current || !oldestRef.current) {
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

        const liveKeys = useMemo(() => new Set(activeLive.map(getMessageKey).filter(Boolean)), [activeLive]);
        const cleanOlder = useMemo(() => {
            if (activeServerBatch?.empty) {
                return [];
            }
            return dropMissingFromBatch(activeOlder, activeServerBatch, liveKeys);
        }, [activeOlder, activeServerBatch, liveKeys]);
        const renderLocals = useMemo(() => {
            if (!liveKeys.size) {
                return locals;
            }
            return locals.filter((message) => {
                const key = getMessageKey(message);
                return !key || !liveKeys.has(key);
            });
        }, [liveKeys, locals]);
        const rawMessages = useMemo(() => filterChatMessages(mergeMessages(cleanOlder, activeLive, renderLocals), chatPK, peerChatPK), [activeLive, chatPK, cleanOlder, renderLocals, peerChatPK]);
        const messagesWithRetention = useMemo(() => applyMessageRetentionTimeline(rawMessages), [rawMessages]);
        const retainedMessages = useMemo(
            () =>
                filterSeenMessages(messagesWithRetention, chatPK, peerChatPK, {
                    keepKeys: visibleMessageKeysRef.current,
                }),
            [chatPK, messagesWithRetention, peerChatPK]
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
            leaveTtlRef.current = {
                chatId,
                exists: activeExists,
                ready: activeReady,
                messages,
            };
        }, [activeExists, activeReady, chatId, messages]);

        useEffect(() => {
            if (!chatId) {
                return undefined;
            }

            const leavingChatId = chatId;
            retainMessageView(scopeKey);
            return () => {
                const current = leaveTtlRef.current;
                releaseMessageView(scopeKey, () => {
                    if (current?.chatId === leavingChatId && current.ready && current.exists && current.messages?.length) {
                        const expiredMessages = getSeenHiddenMessages(current.messages, chatPK, peerChatPK);
                        if (expiredMessages.length) {
                            expireMessageViewCache(viewCacheRef.current, scopeKey, expiredMessages);
                            expireMessageBatch?.(leavingChatId, expiredMessages);
                        }
                    }
                });
            };
        }, [chatId, chatPK, expireMessageBatch, peerChatPK, scopeKey]);

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
