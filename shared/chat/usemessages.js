'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterChatMessages, getPeerChatPKFromChatId, listenToMsgDeletes, loadOlderMsgs, MSG_BATCH_SIZE } from './utils.js';
import { getMessageKey, getMessageOrderMs, mergeMessages } from './state.js';
import { dropCachedMedia } from '../localdatacache.js';
import { deriveMessageReactions, getLatestOwnReadReceiptTarget, getLatestReadReceiptTarget } from './messages.js';

function isDenied(error) {
    return error?.code === 'permission-denied';
}

function getMessagesBatch(messages) {
    if (!messages?.length) {
        return null;
    }

    const firstMs = getMessageOrderMs(messages[0]);
    const lastMs = getMessageOrderMs(messages[messages.length - 1]);
    if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) {
        return null;
    }
    return { firstMs, lastMs };
}

function isMissingFromBatch(message, msgBatch, keys) {
    if (!msgBatch || !message) {
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

    const live = filterChatMessages(msgBatch.messages, chatPK, peerChatPK);
    return {
        older: [],
        live,
        hasOlder: msgBatch.hasOlder,
        ready: true,
        exists: true,
        serverBatch: live.length ? getMessagesBatch(live) : { empty: true },
        oldest: msgBatch.cursor,
        olderLoaded: false,
    };
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
            subscribeMessageBatch,
            getMessageBatch: getSharedMessageBatch,
            getChatRowLastMsgKey,
        } = useChat();
        const { chatPK } = useUser();
        const { chatPrivateKey, localCache } = useVault();

        const peerChatPK = useMemo(() => getPeerChatPKFromChatId(chatId, chatPK), [chatId, chatPK]);
        const scopeKey = `${chatId || ''}:${chatPK || ''}:${chatPrivateKey ? 'unlocked' : 'locked'}:${peerChatPK || ''}`;
        const initialSeed = messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK);

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
        const liveRef = useRef(initialSeed?.live ?? []);
        const loadingOlderRef = useRef(false);
        const runRef = useRef(0);
        const scopeRef = useRef('');

        if (scopeRef.current !== scopeKey) {
            scopeRef.current = scopeKey;
            runRef.current += 1;
        }
        const chatExists = !!(chatId && hasChatDoc(chatId));
        const rowLastMsgKey = chatId && typeof getChatRowLastMsgKey === 'function' ? getChatRowLastMsgKey(chatId) : null;
        const locals = useMemo(() => (chatId ? getMessages(chatId) : []), [chatId, getMessages]);

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
            const nextInitial = messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK);

            setOlder(nextInitial?.older ?? []);
            setLive(nextInitial?.live ?? []);
            setHasOlder(nextInitial?.hasOlder ?? false);
            setLoadingOlder(false);
            setReady(nextInitial?.ready ?? !chatId);
            setExists(nextInitial?.exists ?? false);
            setServerBatch(nextInitial?.serverBatch ?? null);
            setStateScope(scopeKey);
            oldestRef.current = nextInitial?.oldest ?? null;
            olderLoadedRef.current = !!nextInitial?.olderLoaded;
            liveRef.current = nextInitial?.live ?? [];
            loadingOlderRef.current = false;
        }, [chatId, chatPK, chatPrivateKey, getSharedMessageBatch, peerChatPK, scopeKey]);

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
                    if (!liveRef.current.length) {
                        setReady(false);
                    }
                    return;
                }

                const chatMessages = filterChatMessages(msgBatch.messages, chatPK, peerChatPK);

                if (chatId && wasChatDeletedLocally?.(chatId)) {
                    ackDeletedChat?.(chatId);
                }

                const prevLive = liveRef.current;
                const firstMs = chatMessages.length ? getMessageOrderMs(chatMessages[0]) : Infinity;
                const nextKeys = new Set(chatMessages.map(getMessageKey).filter(Boolean));
                const overflow = prevLive.filter((message) => getMessageOrderMs(message) < firstMs && !nextKeys.has(getMessageKey(message)));
                const liveBatch = getMessagesBatch(chatMessages);

                if (!chatMessages.length) {
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

                liveRef.current = chatMessages;
                setStateScope(scopeKey);
                setLive(chatMessages);
                ackMessages(
                    chatId,
                    chatMessages.map((message) => message?.cid)
                );
                setExists(true);
                setReady(true);
            };

            ensureMessageBatch?.(chatId, {
                source: 'route',
                peerChatPK,
                rowLastMsgKey,
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

                    const removedIds = new Set(removed);
                    const drop = (messages) => {
                        let changed = false;
                        const next = [];
                        for (const message of messages || []) {
                            if (removedIds.has(message.id)) {
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
            if (stateScope !== scopeKey || !chatId || !chatExists || !chatPK || !chatPrivateKey || !peerChatPK || !hasOlder || loadingOlderRef.current || !oldestRef.current) {
                return false;
            }

            loadingOlderRef.current = true;
            setLoadingOlder(true);
            const runId = runRef.current;
            try {
                const page = await loadOlderMsgs(db, chatId, chatPK, chatPrivateKey, peerChatPK, oldestRef.current, pageSize);
                if (runId !== runRef.current) {
                    return false;
                }
                if (page.cursor) {
                    oldestRef.current = page.cursor;
                }
                olderLoadedRef.current = true;
                if (page.messages.length) {
                    const pageBatch = getMessagesBatch(page.messages);
                    const pageKeys = new Set(page.messages.map(getMessageKey).filter(Boolean));
                    setOlder((prev) => {
                        const kept = [];
                        for (const message of prev || []) {
                            if (isMissingFromBatch(message, pageBatch, pageKeys)) {
                                dropMessageMedia(localCache, message);
                            } else {
                                kept.push(message);
                            }
                        }
                        return mergeMessages(page.messages, kept);
                    });
                }
                setHasOlder(page.hasMore);
                return page.messages.length > 0;
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
        }, [chatExists, chatId, chatPK, chatPrivateKey, db, hasOlder, localCache, pageSize, peerChatPK, scopeKey, stateScope]);

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
        const rawMessages = useMemo(() => filterChatMessages(mergeMessages(cleanOlder, activeLive, locals), chatPK, peerChatPK), [activeLive, chatPK, cleanOlder, locals, peerChatPK]);
        const messages = useMemo(() => deriveMessageReactions(rawMessages, chatPK, peerChatPK), [chatPK, peerChatPK, rawMessages]);

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
