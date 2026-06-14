'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterChatMessages, getChatPeerPK } from './ids.js';
import { keySet, addMessageKeys, messageHasKey, messageKeys } from './messagekeys.js';
import { decryptMsg, MSG_BATCH_SIZE } from './messages/query.js';
import { deriveRouteMessages, dropDeletedMessageWindow, dropMessageMedia, expireMessageView, getMessagesBatch, holdCurrentLiveMessages, isMissingFromBatch, makeMessageViewSeed, messageSeedFromBatch, messageSeedFromView, removeMessagesByKeys, selectRouteMessageState, trimExpiredMessages } from './messages/window.js';
import { getMessageKey, getMessageOrderMs, mergeMessages } from './state.js';
import { getLatestOwnReadReceiptTarget, getLatestReadReceiptTarget, getSeenHiddenMessages } from './messages.js';
import { getPreviewDropSync, getPreviewUpdateSync } from './messages/preview.js';
import { resolveRenderableMessages } from './resolve.js';
import { timestampKey } from '../utils/time.js';

const MESSAGE_DECRYPT_CACHE_LIMIT = 500;
const OLDER_LOAD_YIELD_EVERY = 3;

function isDenied(error) {
    return error?.code === 'permission-denied';
}

function isAbortError(error) {
    return error?.name === 'AbortError';
}

function yieldToMain() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function afterCurrentTurn(fn) {
    setTimeout(fn, 0);
}

function abortOlderLoad(ref) {
    ref.current?.controller?.abort?.();
    ref.current = null;
}

function mergeOlderPage(pageMessages, currentOlder, pageBatch, pageKeys, localCache) {
    const kept = [];
    for (const message of currentOlder || []) {
        if (messageHasKey(message, pageKeys)) {
            continue;
        }
        if (isMissingFromBatch(message, pageBatch, pageKeys)) {
            dropMessageMedia(localCache, message);
            continue;
        }
        kept.push(message);
    }

    if (!pageMessages?.length) {
        return kept;
    }
    if (!kept.length) {
        return pageMessages;
    }

    const lastPageMs = getMessageOrderMs(pageMessages[pageMessages.length - 1]);
    const firstKeptMs = getMessageOrderMs(kept[0]);
    if (Number.isFinite(lastPageMs) && Number.isFinite(firstKeptMs) && lastPageMs <= firstKeptMs) {
        return [...pageMessages, ...kept];
    }
    return mergeMessages(pageMessages, kept);
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

function stableMessageViewKey(chatId) {
    const id = String(chatId || '').trim();
    return id ? `chat:${id}` : '';
}

function uniqueMessageViewKeys(...keys) {
    const seen = new Set();
    const out = [];
    for (const key of keys) {
        const value = String(key || '').trim();
        if (!value || seen.has(value)) {
            continue;
        }
        seen.add(value);
        out.push(value);
    }
    return out;
}

function cachedMessageViewSeed(getMessageView, keys) {
    if (typeof getMessageView !== 'function') {
        return null;
    }

    let fallback = null;
    for (const key of keys || []) {
        const seed = messageSeedFromView(getMessageView(key));
        if (!seed) {
            continue;
        }
        if (hasLoadedOlderWindow(seed)) {
            return seed;
        }
        fallback ??= seed;
    }
    return fallback;
}

function messageViewRuntime(getMessageViewRuntime, keys) {
    if (typeof getMessageViewRuntime !== 'function') {
        return null;
    }
    for (const key of keys || []) {
        const runtime = getMessageViewRuntime(key);
        if (runtime) {
            return runtime;
        }
    }
    return null;
}

function runtimeMap(runtime, key) {
    if (!runtime) {
        return new Map();
    }
    if (!(runtime[key] instanceof Map)) {
        runtime[key] = new Map();
    }
    return runtime[key];
}

function runtimeSet(runtime, key) {
    if (!runtime) {
        return new Set();
    }
    if (!(runtime[key] instanceof Set)) {
        runtime[key] = new Set();
    }
    return runtime[key];
}

function clearRuntimeDerived(runtime) {
    if (runtime) {
        runtime.derived = null;
    }
}

function sameMarker(a, b) {
    return (a?.id ?? null) === (b?.id ?? null) && timestampKey(a?.ts ?? null) === timestampKey(b?.ts ?? null);
}

function sameSet(a, b) {
    if (a === b) {
        return true;
    }
    const left = keySet(a);
    const right = keySet(b);
    if (left.size !== right.size) {
        return false;
    }
    for (const key of left) {
        if (!right.has(key)) {
            return false;
        }
    }
    return true;
}

function sameServerBatch(a, b) {
    if (a === b) {
        return true;
    }
    if (!a || !b) {
        return !a && !b;
    }
    return (
        !!a.empty === !!b.empty &&
        a.firstMs === b.firstMs &&
        a.lastMs === b.lastMs &&
        sameSet(a.expiredKeys, b.expiredKeys) &&
        sameSet(a.deletedKeys, b.deletedKeys)
    );
}

function sameInitialState(refs, stateScope, scopeKey, nextInitial, chatId) {
    const nextOlder = nextInitial?.older ?? [];
    const nextLive = nextInitial?.live ?? [];
    const nextHasOlder = nextInitial?.hasOlder ?? false;
    const nextReady = nextInitial?.ready ?? !chatId;
    const nextExists = nextInitial?.exists ?? false;
    const nextServerBatch = nextInitial?.serverBatch ?? null;
    return (
        stateScope === scopeKey &&
        refs.older.current === nextOlder &&
        refs.live.current === nextLive &&
        refs.hasOlder.current === nextHasOlder &&
        refs.ready.current === nextReady &&
        refs.exists.current === nextExists &&
        sameServerBatch(refs.serverBatch.current, nextServerBatch) &&
        sameMarker(refs.olderThan.current, nextInitial?.olderThan ?? null) &&
        refs.olderLoaded.current === !!nextInitial?.olderLoaded
    );
}

function deriveRouteMessagesCached(runtime, params) {
    const cached = runtime?.derived;
    if (
        cached &&
        cached.older === params.older &&
        cached.live === params.live &&
        cached.locals === params.locals &&
        cached.serverBatch === params.serverBatch &&
        cached.deletedKeys === params.deletedKeys &&
        cached.visibleKeys === params.visibleKeys &&
        cached.heldMessages === params.heldMessages &&
        cached.chatPK === params.chatPK &&
        cached.peerChatPK === params.peerChatPK
    ) {
        return cached.value;
    }
    const value = deriveRouteMessages(params);
    if (runtime) {
        runtime.derived = {
            older: params.older,
            live: params.live,
            locals: params.locals,
            serverBatch: params.serverBatch,
            deletedKeys: params.deletedKeys,
            visibleKeys: params.visibleKeys,
            heldMessages: params.heldMessages,
            chatPK: params.chatPK,
            peerChatPK: params.peerChatPK,
            value,
        };
    }
    return value;
}

function addMessageRecordKeys(keys, record) {
    if (!keys || !record) {
        return;
    }
    if (record.id) {
        keys.add(record.id);
    }
    if (record.head?.cid) {
        keys.add(record.head.cid);
    }
}

function cleanPeerChatPK(value) {
    const text = String(value || '').trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(text) ? text : '';
}

function serverMessageId(message) {
    const id = String(message?.id || '').trim();
    return id && !id.startsWith('local:') ? id : '';
}

function recordServerId(record) {
    const id = String(record?.id || '').trim();
    return id && !id.startsWith('local:') ? id : '';
}

function recordCid(record) {
    return String(record?.head?.cid || '').trim();
}

function patchMessageFromRecord(message, record) {
    if (!message || !record) {
        return null;
    }

    const id = recordServerId(record);
    const cid = recordCid(record);
    const messageId = serverMessageId(message);
    const messageCid = String(message?.cid || '').trim();
    const idMatches = !!(id && messageId && id === messageId);
    const cidMatches = !!(cid && messageCid && cid === messageCid);
    if (!idMatches && !cidMatches) {
        return null;
    }
    if (cid && messageCid && cid !== messageCid) {
        return null;
    }

    const nextTs = record.ts ?? null;
    const nextTtl = record.ttl ?? null;
    if (message.id === id && timestampKey(message.ts ?? null) === timestampKey(nextTs) && timestampKey(message.ttl ?? null) === timestampKey(nextTtl)) {
        return message;
    }

    return {
        ...message,
        ...(id ? { id } : {}),
        ts: nextTs,
        ttl: nextTtl,
    };
}

function trimDecryptCache(cache, limit = MESSAGE_DECRYPT_CACHE_LIMIT) {
    if (!(cache instanceof Map) || cache.size <= limit) {
        return;
    }
    while (cache.size > limit) {
        const oldest = cache.keys().next().value;
        if (!oldest) {
            return;
        }
        cache.delete(oldest);
    }
}

export function createUseChatMessages({ useChat, useUser, useVault, appState, pageSize = MSG_BATCH_SIZE }) {
    if (typeof useChat !== 'function' || typeof useUser !== 'function' || typeof useVault !== 'function') {
        throw new Error('createUseChatMessages requires { useChat, useUser, useVault }');
    }

    return function useChatMessages(chatId, options = null) {
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
            getMessageViewRuntime,
            rememberMessageView,
            updateMessageView,
            retainMessageView,
            releaseMessageView,
            getChatPreviewKey,
            syncChatPreview,
            syncChatPreviewDrop,
            adoptConfirmedMessages,
            loadOlderMessages,
            watchMessageWindow,
        } = messageBatches;
        const { chatPK } = useUser();
        const { chatPrivateKey, localCache } = useVault();

        const currentChat = useMemo(() => (chats || []).find((chatItem) => chatItem?.id === chatId) || null, [chatId, chats]);
        const optionPeerChatPK = cleanPeerChatPK(typeof options === 'string' ? options : options?.peerChatPK);
        const peerChatPK = useMemo(() => getChatPeerPK(currentChat, chatPK) || optionPeerChatPK, [chatPK, currentChat, optionPeerChatPK]);
        const chatPreview = currentChat?.preview || null;
        const scopeKey = `${chatId || ''}:${chatPK || ''}:${chatPrivateKey ? 'unlocked' : 'locked'}:${peerChatPK || ''}`;
        const messageViewKey = stableMessageViewKey(chatId);
        const messageViewKeys = useMemo(() => uniqueMessageViewKeys(messageViewKey, scopeKey), [messageViewKey, scopeKey]);
        const viewRuntime = messageViewRuntime(getMessageViewRuntime, messageViewKeys);
        const initialSeed = pickInitialMessageSeed(
            messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK),
            cachedMessageViewSeed(getMessageView, messageViewKeys)
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
        const readyRef = useRef(initialSeed?.ready ?? !chatId);
        const existsRef = useRef(initialSeed?.exists ?? false);
        const olderRef = useRef(initialSeed?.older ?? []);
        const liveRef = useRef(initialSeed?.live ?? []);
        const serverBatchRef = useRef(initialSeed?.serverBatch ?? null);
        const loadingOlderRef = useRef(false);
        const runRef = useRef(0);
        const applyBatchRef = useRef(0);
        const droppedMessageKeysRef = useRef(new Set());
        const resolvedMessageKeysRef = useRef(new Set());
        const chatPreviewKeyRef = useRef(null);
        const localsRef = useRef([]);
        const runtimeRef = useRef(viewRuntime);
        const decryptedCacheRef = useRef(runtimeMap(viewRuntime, 'decrypted'));
        const scopeRef = useRef('');
        const leaveTtlRef = useRef(null);
        const visibleMessageKeysRef = useRef(runtimeSet(viewRuntime, 'visibleKeys'));
        const deletedMessageKeysRef = useRef(runtimeSet(viewRuntime, 'deletedKeys'));
        const heldMessagesRef = useRef(runtimeMap(viewRuntime, 'held'));
        const lastPreviewDropSyncRef = useRef('');
        const lastPreviewUpdateSyncRef = useRef('');
        const lastOwnReadTargetRef = useRef('');
        const lastPeerReadTargetRef = useRef('');
        const liveWindowMarkerRef = useRef(null);
        const dropDeletedMessagesRef = useRef(() => {});
        const updateChangedMessagesRef = useRef(() => {});
        const olderLoadAbortRef = useRef(null);

        if (runtimeRef.current !== viewRuntime) {
            runtimeRef.current = viewRuntime;
            decryptedCacheRef.current = runtimeMap(viewRuntime, 'decrypted');
            visibleMessageKeysRef.current = runtimeSet(viewRuntime, 'visibleKeys');
            deletedMessageKeysRef.current = runtimeSet(viewRuntime, 'deletedKeys');
            heldMessagesRef.current = runtimeMap(viewRuntime, 'held');
        }

        if (scopeRef.current !== scopeKey) {
            scopeRef.current = scopeKey;
            runRef.current += 1;
            visibleMessageKeysRef.current = runtimeSet(viewRuntime, 'visibleKeys');
            deletedMessageKeysRef.current = runtimeSet(viewRuntime, 'deletedKeys');
            heldMessagesRef.current = runtimeMap(viewRuntime, 'held');
            lastPreviewDropSyncRef.current = '';
            lastPreviewUpdateSyncRef.current = '';
            lastOwnReadTargetRef.current = '';
            lastPeerReadTargetRef.current = '';
            decryptedCacheRef.current = runtimeMap(viewRuntime, 'decrypted');
            clearRuntimeDerived(viewRuntime);
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
            serverBatchRef.current = serverBatch;
        }, [serverBatch]);

        useEffect(() => {
            readyRef.current = ready;
        }, [ready]);

        useEffect(() => {
            existsRef.current = exists;
        }, [exists]);

        useEffect(() => {
            if (!viewRuntime) {
                return;
            }
            viewRuntime.decrypted = decryptedCacheRef.current;
            viewRuntime.held = heldMessagesRef.current;
            viewRuntime.visibleKeys = visibleMessageKeysRef.current;
            viewRuntime.deletedKeys = deletedMessageKeysRef.current;
        });

        const rememberMessageViewSeed = useCallback(
            (seed) => {
                if (!seed?.ready || typeof rememberMessageView !== 'function') {
                    return;
                }
                for (const key of messageViewKeys) {
                    rememberMessageView(key, seed);
                }
            },
            [messageViewKeys, rememberMessageView]
        );

        useEffect(() => {
            const nextInitial = pickInitialMessageSeed(
                messageSeedFromBatch(typeof getSharedMessageBatch === 'function' ? getSharedMessageBatch(chatId) : null, chatPK, peerChatPK),
                cachedMessageViewSeed(getMessageView, messageViewKeys)
            );
            const refs = {
                older: olderRef,
                live: liveRef,
                hasOlder: hasOlderRef,
                ready: readyRef,
                exists: existsRef,
                serverBatch: serverBatchRef,
                olderThan: olderThanRef,
                olderLoaded: olderLoadedRef,
            };
            if (sameInitialState(refs, stateScope, scopeKey, nextInitial, chatId)) {
                return;
            }

            runRef.current += 1;

            setOlder(nextInitial?.older ?? []);
            setLive(nextInitial?.live ?? []);
            setHasOlder(nextInitial?.hasOlder ?? false);
            hasOlderRef.current = nextInitial?.hasOlder ?? false;
            setLoadingOlder(false);
            setReady(nextInitial?.ready ?? !chatId);
            readyRef.current = nextInitial?.ready ?? !chatId;
            setExists(nextInitial?.exists ?? false);
            existsRef.current = nextInitial?.exists ?? false;
            setServerBatch(nextInitial?.serverBatch ?? null);
            serverBatchRef.current = nextInitial?.serverBatch ?? null;
            setStateScope(scopeKey);
            olderThanRef.current = nextInitial?.olderThan ?? null;
            olderLoadedRef.current = !!nextInitial?.olderLoaded;
            olderRef.current = nextInitial?.older ?? [];
            liveRef.current = nextInitial?.live ?? [];
            loadingOlderRef.current = false;
            applyBatchRef.current += 1;
            droppedMessageKeysRef.current = new Set();
            resolvedMessageKeysRef.current = new Set();
            visibleMessageKeysRef.current = runtimeSet(viewRuntime, 'visibleKeys');
            deletedMessageKeysRef.current = runtimeSet(viewRuntime, 'deletedKeys');
            heldMessagesRef.current = runtimeMap(viewRuntime, 'held');
            lastPreviewDropSyncRef.current = '';
            lastPreviewUpdateSyncRef.current = '';
            lastOwnReadTargetRef.current = '';
            lastPeerReadTargetRef.current = '';
            decryptedCacheRef.current = runtimeMap(viewRuntime, 'decrypted');
            clearRuntimeDerived(viewRuntime);
        }, [chatId, chatPK, chatPrivateKey, getMessageView, getSharedMessageBatch, messageViewKeys, peerChatPK, scopeKey, stateScope, viewRuntime]);

        useEffect(
            () => () => {
                abortOlderLoad(olderLoadAbortRef);
            },
            [scopeKey]
        );

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
                setServerBatch((prev) => {
                    const next = prev ? { ...prev, deletedKeys: result.deletedKeys } : { empty: true, deletedKeys: result.deletedKeys };
                    serverBatchRef.current = next;
                    return next;
                });
            },
            [ackMessages, chatId, localCache]
        );

        const updateChangedMessages = useCallback(
            (records = []) => {
                if (!records?.length || !chatId || !chatPK || !chatPrivateKey || !peerChatPK) {
                    return;
                }

                const touchedKeys = new Set();
                for (const record of records) {
                    addMessageRecordKeys(touchedKeys, record);
                }
                if (!touchedKeys.size) {
                    return;
                }

                const patchedRecordKeys = new Set();
                const patchMetadata = (messages) => {
                    let changed = false;
                    const patched = (messages || []).map((message) => {
                        for (const record of records) {
                            const nextMessage = patchMessageFromRecord(message, record);
                            if (!nextMessage) {
                                continue;
                            }
                            addMessageRecordKeys(patchedRecordKeys, record);
                            if (nextMessage !== message) {
                                changed = true;
                            }
                            return nextMessage;
                        }
                        return message;
                    });
                    return { changed, messages: patched };
                };
                const olderPatch = patchMetadata(olderRef.current);
                const livePatch = patchMetadata(liveRef.current);
                if (olderPatch.changed) {
                    olderRef.current = olderPatch.messages;
                    setOlder(olderPatch.messages);
                }
                if (livePatch.changed) {
                    liveRef.current = livePatch.messages;
                    setLive(livePatch.messages);
                }

                const recordsToResolve = records.filter((record) => {
                    const keys = new Set();
                    addMessageRecordKeys(keys, record);
                    for (const key of keys) {
                        if (patchedRecordKeys.has(key)) {
                            return false;
                        }
                    }
                    return true;
                });
                if (!recordsToResolve.length) {
                    return;
                }

                const runId = runRef.current;
                void Promise.resolve()
                    .then(async () => {
                        const decrypted = [];
                        const expiredKeys = new Set();
                        const deletedKeys = keySet(deletedMessageKeysRef.current);
                        for (const record of recordsToResolve) {
                            const message = await decryptMsg(record, chatPK, chatPrivateKey, peerChatPK, { actors: currentChat?.actors, chatId });
                            if (message) {
                                decrypted.push(message);
                            } else {
                                addMessageRecordKeys(expiredKeys, record);
                                addMessageRecordKeys(deletedKeys, record);
                            }
                        }
                        const filtered = removeMessagesByKeys(trimExpiredMessages(filterChatMessages(decrypted, chatPK, peerChatPK), { expiredKeys }), deletedKeys);
                        const resolved = await resolveRenderableMessages(filtered, {
                            peerChatPK,
                            readMessageFile,
                            localCache,
                            droppedKeys: droppedMessageKeysRef.current,
                            resolvedKeys: resolvedMessageKeysRef.current,
                        });
                        return { deletedKeys, expiredKeys, resolved };
                    })
                    .then(({ deletedKeys, expiredKeys, resolved }) => {
                        if (runId !== runRef.current) {
                            return;
                        }

                        if (deletedKeys.size) {
                            deletedMessageKeysRef.current = keySet(deletedKeys);
                            ackMessages(chatId, [...deletedKeys], { remove: true });
                        }

                        const apply = (messages) => {
                            let changed = false;
                            const resolvedKeys = new Set();
                            for (const message of resolved) {
                                addMessageKeys(resolvedKeys, message);
                            }
                            const kept = [];
                            for (const message of messages || []) {
                                if (messageHasKey(message, touchedKeys) && !messageHasKey(message, patchedRecordKeys)) {
                                    changed = true;
                                    if (!messageHasKey(message, resolvedKeys)) {
                                        dropMessageMedia(localCache, message);
                                    }
                                } else {
                                    kept.push(message);
                                }
                            }
                            return { changed, messages: mergeMessages(kept, resolved) };
                        };

                        const olderUpdate = apply(olderRef.current);
                        const liveUpdate = apply(liveRef.current);
                        if (olderUpdate.changed) {
                            olderRef.current = olderUpdate.messages;
                            setOlder(olderUpdate.messages);
                        }
                        if (liveUpdate.changed) {
                            liveRef.current = liveUpdate.messages;
                            setLive(liveUpdate.messages);
                        }
                        if (expiredKeys.size || deletedKeys.size) {
                            setServerBatch((prev) => {
                                const next = { ...(prev || {}), expiredKeys: keySet([...(prev?.expiredKeys || []), ...expiredKeys]), deletedKeys };
                                serverBatchRef.current = next;
                                return next;
                            });
                        }
                    })
                    .catch((error) => {
                        if (!isDenied(error)) {
                            console.warn('Message window update failed', chatId, error);
                        }
                    });
            },
            [ackMessages, chatId, chatPK, chatPrivateKey, currentChat?.actors, localCache, peerChatPK, readMessageFile]
        );
        dropDeletedMessagesRef.current = dropDeletedMessages;
        updateChangedMessagesRef.current = updateChangedMessages;

        useEffect(() => {
            if (stateScope !== scopeKey) {
                return;
            }
            const seed = makeMessageViewSeed({
                older,
                live,
                hasOlder,
                ready,
                exists,
                serverBatch,
                olderThan: olderThanRef.current,
                olderLoaded: olderLoadedRef.current,
            });
            rememberMessageViewSeed(seed);
        }, [exists, hasOlder, live, older, ready, rememberMessageViewSeed, scopeKey, serverBatch, stateScope]);

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
                    serverBatchRef.current = { empty: true };
                    setReady(true);
                    olderThanRef.current = null;
                    olderLoadedRef.current = false;
                    liveRef.current = [];
                    loadingOlderRef.current = false;
                    return;
                }

                if (olderRef.current.length || liveRef.current.length || localsRef.current.length) {
                    setExists(true);
                    setReady(true);
                    setLoadingOlder(false);
                    loadingOlderRef.current = false;
                    return;
                }

                setOlder([]);
                setLive([]);
                setHasOlder(false);
                setLoadingOlder(false);
                setExists(false);
                setServerBatch(null);
                serverBatchRef.current = null;
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
                    serverBatchRef.current = null;
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
                            serverBatchRef.current = { empty: true, expiredKeys, deletedKeys };
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
                                const olderMessages = changed ? next : prev;
                                olderRef.current = olderMessages;
                                return olderMessages;
                            });
                            setServerBatch(liveBatch);
                            serverBatchRef.current = liveBatch;
                        } else {
                            setServerBatch((prev) => {
                                const next = { ...(prev || {}), expiredKeys, deletedKeys };
                                serverBatchRef.current = next;
                                return next;
                            });
                        }

                        if (overflow.length) {
                            setOlder((prev) => {
                                const next = mergeMessages(prev, overflow);
                                olderRef.current = next;
                                return next;
                            });
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
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const loadToken = { controller };
            abortOlderLoad(olderLoadAbortRef);
            olderLoadAbortRef.current = loadToken;
            try {
                const previousOlderThan = olderThanRef.current;
                const currentChat = (chats || []).find((chatItem) => chatItem?.id === chatId);
                const page = await loadOlderMessages(chatId, chatPK, chatPrivateKey, peerChatPK, olderThanRef.current, pageSize, {
                    actors: currentChat?.actors,
                    decryptedCache: decryptedCacheRef.current,
                    signal: controller?.signal,
                    yieldEvery: OLDER_LOAD_YIELD_EVERY,
                });
                trimDecryptCache(decryptedCacheRef.current);
                if (controller?.signal?.aborted || runId !== runRef.current) {
                    return false;
                }
                const olderThanChanged = !!page.nextOlderThan && page.nextOlderThan?.id !== previousOlderThan?.id;
                if (page.nextOlderThan) {
                    olderThanRef.current = page.nextOlderThan;
                }
                olderLoadedRef.current = true;
                if (page.messages.length) {
                    const pageBatch = getMessagesBatch(page.messages);
                    const pageKeys = new Set();
                    for (const message of page.messages) {
                        addMessageKeys(pageKeys, message);
                    }
                    await yieldToMain();
                    if (controller?.signal?.aborted || runId !== runRef.current) {
                        return false;
                    }
                    const resolvedMessages = await resolveRenderableMessages(page.messages, {
                        peerChatPK,
                        readMessageFile,
                        localCache,
                        droppedKeys: droppedMessageKeysRef.current,
                        resolvedKeys: resolvedMessageKeysRef.current,
                    });
                    await yieldToMain();
                    if (controller?.signal?.aborted || runId !== runRef.current) {
                        return false;
                    }
                    const nextOlder = mergeOlderPage(resolvedMessages, olderRef.current, pageBatch, pageKeys, localCache);
                    olderRef.current = nextOlder;
                    setOlder(nextOlder);
                }
                hasOlderRef.current = page.hasMore;
                setHasOlder(page.hasMore);
                rememberMessageViewSeed(
                    makeMessageViewSeed({
                        older: olderRef.current,
                        live: liveRef.current,
                        hasOlder: page.hasMore,
                        ready: true,
                        exists: true,
                        serverBatch: serverBatchRef.current,
                        olderThan: olderThanRef.current,
                        olderLoaded: olderLoadedRef.current,
                    })
                );
                return page.messages.length > 0 || olderThanChanged;
            } catch (error) {
                if (!isAbortError(error) && !isDenied(error)) {
                    console.warn('Older messages load failed', chatId, error);
                }
                return false;
            } finally {
                const ownsOlderLoad = olderLoadAbortRef.current === loadToken;
                if (ownsOlderLoad) {
                    olderLoadAbortRef.current = null;
                }
                if (ownsOlderLoad || !olderLoadAbortRef.current) {
                    loadingOlderRef.current = false;
                }
                if (ownsOlderLoad && runId === runRef.current && !controller?.signal?.aborted) {
                    setLoadingOlder(false);
                }
            }
        }, [chatExists, chatId, chatPK, chatPrivateKey, chats, loadOlderMessages, localCache, pageSize, peerChatPK, readMessageFile, scopeKey, stateScope]);

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
                setServerBatch((prev) => {
                    const next = { ...(prev || {}), deletedKeys: nextDeletedKeys };
                    serverBatchRef.current = next;
                    return next;
                });
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
        const liveWindowMarker = useMemo(() => activeLive.find((message) => serverMessageId(message) && message?.ts) || null, [activeLive]);
        const liveWindowKey = useMemo(() => {
            const id = serverMessageId(liveWindowMarker);
            return id ? `${id}:${getMessageOrderMs(liveWindowMarker)}` : '';
        }, [liveWindowMarker]);

        const routeMessages = useMemo(
            () =>
                deriveRouteMessagesCached(viewRuntime, {
                    older: activeOlder,
                    live: activeLive,
                    locals,
                    serverBatch: activeServerBatch,
                    deletedKeys: deletedMessageKeysRef.current,
                    visibleKeys: visibleMessageKeysRef.current,
                    heldMessages: heldMessagesRef.current,
                    chatPK,
                    peerChatPK,
                }),
            [activeOlder, activeLive, activeServerBatch, chatPK, locals, peerChatPK, viewRuntime]
        );
        const { rawMessages, messages, visibleMessages } = routeMessages;

        useEffect(() => {
            const keys = new Set();
            for (const message of visibleMessages || []) {
                addMessageKeys(keys, message);
            }
            visibleMessageKeysRef.current = keys;
            if (viewRuntime) {
                viewRuntime.visibleKeys = keys;
            }
        }, [viewRuntime, visibleMessages]);

        useEffect(() => {
            liveWindowMarkerRef.current = liveWindowMarker;
        }, [liveWindowMarker]);

        useEffect(() => {
            if (!chatId || !activeReady || !activeExists || !isActive || typeof watchMessageWindow !== 'function') {
                return undefined;
            }

            const marker = liveWindowMarkerRef.current;
            if (!marker || !liveWindowKey) {
                return undefined;
            }

            let current = true;
            const unsubscribe = watchMessageWindow(
                chatId,
                { id: serverMessageId(marker), ts: marker.ts },
                ({ keys, removedKeys, expiredKeys, cidById, changedRecords } = {}) => {
                    if (!current) {
                        return;
                    }
                    dropDeletedMessagesRef.current(removedKeys, keys, getMessageOrderMs(marker), cidById, expiredKeys);
                    updateChangedMessagesRef.current(changedRecords);
                },
                (error) => {
                    if (!isDenied(error)) {
                        console.warn('Message window listener error', chatId, error);
                    }
                }
            );
            return () => {
                current = false;
                unsubscribe?.();
            };
        }, [activeExists, activeReady, chatId, isActive, liveWindowKey, watchMessageWindow]);

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
            for (const key of messageViewKeys) {
                retainMessageView?.(key);
            }
            return () => {
                const current = leaveTtlRef.current;
                let releasedRoute = false;
                const onReleaseRoute = () => {
                    if (releasedRoute) {
                        return;
                    }
                    releasedRoute = true;
                    afterCurrentTurn(() => {
                        if (current?.chatId === leavingChatId && current.ready && current.exists && (current.messages?.length || current.rawMessages?.length)) {
                            const expirySource = current.rawMessages?.length ? current.rawMessages : current.messages;
                            const expiredMessages = getSeenHiddenMessages(expirySource, chatPK, peerChatPK);
                            if (expiredMessages.length) {
                                for (const key of messageViewKeys) {
                                    expireMessageView(updateMessageView, key, expiredMessages);
                                }
                                expireMessageBatch?.(leavingChatId, expiredMessages);
                            }
                        }
                    });
                };
                for (const key of messageViewKeys) {
                    releaseMessageView?.(key, onReleaseRoute);
                }
            };
        }, [chatId, chatPK, expireMessageBatch, messageViewKeys, peerChatPK, releaseMessageView, retainMessageView, updateMessageView]);

        useEffect(() => {
            if (!chatId || !activeReady || !activeExists || !chatPK || !messages.length) {
                return;
            }

            const ownTarget = getLatestOwnReadReceiptTarget(messages, chatPK);
            const ownTargetKey = getMessageKey(ownTarget) || '';
            if (ownTargetKey && ownTargetKey !== lastOwnReadTargetRef.current) {
                lastOwnReadTargetRef.current = ownTargetKey;
                markChatRead?.(chatId, ownTarget);
            } else if (!ownTargetKey) {
                lastOwnReadTargetRef.current = '';
            }

            const target = getLatestReadReceiptTarget(messages, chatPK);
            const targetKey = getMessageKey(target) || '';
            if (targetKey && targetKey !== lastPeerReadTargetRef.current) {
                lastPeerReadTargetRef.current = targetKey;
                markChatReadReceipt?.(chatId, target);
            } else if (!targetKey) {
                lastPeerReadTargetRef.current = '';
            }
        }, [activeExists, activeReady, chatId, chatPK, markChatRead, markChatReadReceipt, messages]);

        return {
            messages,
            visibleMessages,
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
