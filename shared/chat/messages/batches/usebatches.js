'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { readCachedMedia, writeCachedMedia } from '../../../cache/localdata.js';
import { saveMedia } from '../../attachments.js';
import { filterChatMessages, getChatPeerPK, getChatPreviewKey } from '../../ids.js';
import { collectMessageKeys } from '../../messagekeys.js';
import { getHiddenDisplayMessages } from '../../messages.js';
import { listenToLatestMsgs } from '../query.js';
import { readMsgMedia } from '../write.js';
import { makeMessagePreviewMedia, MESSAGE_PREVIEW_MIME } from '../../previews.js';
import { getMessageKey } from '../../state.js';
import { MESSAGE_VIEW_CACHE_SIZE, normalizeChatWarming } from './config.js';
import { runMessageBatchCleanup } from './cleanup.js';
import { nonNegativeNumber, positiveNumber } from '../../../utils/number.js';
import { getMediaTasks, waitForMediaIdle } from './media.js';
import { getBatchPreviewKey, isBatchFresh, makeMessageBatchSnapshot, nextTrimMs, removeEntryMessages, trimExpiredEntry } from './state.js';
import { createMessageViewCache } from './viewcache.js';
import { warmCandidates, warmTaskKey } from './warm.js';
import { markDiag, markDone, markError } from '../../../utils/diagnostics.js';

function notifyPreviewDrop(onDrop, chatId, keys) {
    const dropped = collectMessageKeys(keys instanceof Set ? [...keys] : keys);
    if (!dropped.size) {
        return;
    }
    onDrop?.(chatId, dropped, null);
}

function notifyRetentionPreviewDrop(onDrop, chatId, messages, chatPK, peerChatPK) {
    const hidden = getHiddenDisplayMessages(messages, chatPK, peerChatPK);
    if (!hidden.length) {
        return;
    }
    onDrop?.(chatId, collectMessageKeys(hidden), null);
}

function warmKeyStore(ref) {
    if (!(ref.current instanceof Map)) {
        ref.current = new Map();
    }
    return ref.current;
}

function readMessageMedia(cloud, media, chatPK, chatPrivateKey, peerChatPK, message) {
    const readChatMedia = cloud?.chat?.media?.read;
    if (typeof media?.readMessageFile === 'function') {
        return media.readMessageFile(readChatMedia, chatPK, chatPrivateKey, peerChatPK, message);
    }
    return readMsgMedia(readChatMedia, chatPK, chatPrivateKey, peerChatPK, message);
}

function isDenied(error) {
    return error?.code === 'permission-denied';
}

export function useChatMessageBatches({ cloud, media = {}, chatPK, chatPrivateKey, chatBanned, isActive, localCache, listRef, pendingDeleteIdsRef, config, preloadMessageMedia, deleteMessages, markMessagesHidden, onRead, onExpire, onUnavailable, diag = null }) {
    const batchesRef = useRef(new Map());
    const generationRef = useRef(0);
    const warmTimerRef = useRef(null);
    const mediaTimerRef = useRef(null);
    const mediaRunRef = useRef(0);
    const mediaAttemptsRef = useRef(new Set());
    const trimTimerRef = useRef(null);
    const pruneExpiredBatchesRef = useRef(null);
    const warmIdsRef = useRef([]);
    const warmQueueRef = useRef([]);
    const warmJobRef = useRef(null);
    const lastWarmKeyRef = useRef(new Map());
    const messageViewCacheRef = useRef(null);
    if (!messageViewCacheRef.current) {
        messageViewCacheRef.current = createMessageViewCache(MESSAGE_VIEW_CACHE_SIZE);
    }
    const warming = useMemo(() => normalizeChatWarming(config), [config]);

    useEffect(() => {
        mediaAttemptsRef.current.clear();
    }, [chatPK, localCache?.id]);

    useEffect(() => {
        messageViewCacheRef.current.resetOwner(chatPK && chatPrivateKey && localCache?.id ? `${localCache.id}:${chatPK}` : '');
    }, [chatPK, chatPrivateKey, localCache?.id]);

    const notify = useCallback((entry) => {
        const snapshot = makeMessageBatchSnapshot(entry);
        for (const subscriber of entry?.subscribers || []) {
            subscriber(snapshot);
        }
    }, []);

    const scheduleTrim = useCallback(() => {
        if (trimTimerRef.current) {
            clearTimeout(trimTimerRef.current);
            trimTimerRef.current = null;
        }

        const ms = nextTrimMs(batchesRef.current.values());
        if (ms == null) {
            return;
        }

        const delay = Math.max(0, Math.min(ms - Date.now() + 25, 2_147_483_647));
        trimTimerRef.current = setTimeout(() => {
            trimTimerRef.current = null;
            pruneExpiredBatchesRef.current?.();
            scheduleTrim();
        }, delay);
    }, []);

    const pruneExpiredBatches = useCallback(() => {
        const now = Date.now();
        for (const entry of batchesRef.current.values()) {
            if (entry.route) {
                continue;
            }
            const expiredMessages = trimExpiredEntry(entry, now);
            if (!expiredMessages.length) {
                continue;
            }
            notifyPreviewDrop(onExpire, entry.chatId, expiredMessages, entry.messages, chatPK, entry.peerChatPK);
            notify(entry);
        }
    }, [notify, onExpire]);

    useEffect(() => {
        pruneExpiredBatchesRef.current = pruneExpiredBatches;
    }, [pruneExpiredBatches]);

    const closeBatch = useCallback((chatId) => {
        const entry = batchesRef.current.get(chatId);
        if (!entry) {
            return;
        }
        try {
            entry.unsub?.();
        } catch {}
        entry.subscribers?.clear?.();
        batchesRef.current.delete(chatId);
        warmIdsRef.current = warmIdsRef.current.filter((id) => id !== chatId);
    }, []);

    const maybeCloseBatch = useCallback(
        (entry) => {
            if (entry?.route || entry?.warm) {
                notify(entry);
                return;
            }
            closeBatch(entry?.chatId);
        },
        [closeBatch, notify]
    );

    const clear = useCallback(() => {
        generationRef.current += 1;
        mediaRunRef.current += 1;
        warmIdsRef.current = [];
        warmKeyStore(lastWarmKeyRef).clear();
        if (warmTimerRef.current) {
            clearTimeout(warmTimerRef.current);
            warmTimerRef.current = null;
        }
        if (mediaTimerRef.current) {
            clearTimeout(mediaTimerRef.current);
            mediaTimerRef.current = null;
        }
        if (trimTimerRef.current) {
            clearTimeout(trimTimerRef.current);
            trimTimerRef.current = null;
        }
        warmQueueRef.current = [];
        warmJobRef.current = null;
        messageViewCacheRef.current.clear();
        for (const entry of batchesRef.current.values()) {
            try {
                entry.unsub?.();
            } catch {}
            entry.subscribers?.clear?.();
        }
        batchesRef.current.clear();
    }, []);

    const buildMediaTasks = useCallback(() => {
        const mediaConfig = warming.media;
        if (!mediaConfig.enabled || !isActive || !chatPK || !chatPrivateKey || chatBanned) {
            return [];
        }

        return getMediaTasks({
            ids: warmIdsRef.current.slice(0, Math.max(0, mediaConfig.chatCount)),
            batches: batchesRef.current,
            chatPK,
            mediaConfig,
            attempts: mediaAttemptsRef.current,
        });
    }, [chatBanned, chatPK, chatPrivateKey, isActive, warming.media]);

    const runMedia = useCallback(
        async (runId) => {
            const mediaConfig = warming.media;
            if (!mediaConfig.enabled || !localCache) {
                return;
            }

            const tasks = buildMediaTasks();
            const readFile = async (peerChatPK, message) => {
                const cached = await readCachedMedia(localCache, message);
                if (cached?.byteLength) {
                    return cached;
                }

                const bytes = await readMessageMedia(cloud, media, chatPK, chatPrivateKey, peerChatPK, message);
                if (bytes?.byteLength) {
                    saveMedia(localCache, message, bytes, message);
                }
                return bytes;
            };
            const readPreview = async (message) => {
                const previewMessage = makeMessagePreviewMedia(message);
                if (!previewMessage) {
                    return null;
                }
                return readCachedMedia(localCache, previewMessage);
            };
            const writePreview = async (message, bytes, meta = {}) => {
                const mimeType = meta?.mimeType || MESSAGE_PREVIEW_MIME;
                const previewMessage = makeMessagePreviewMedia(message, mimeType);
                if (!previewMessage || !bytes?.byteLength) {
                    return false;
                }
                return writeCachedMedia(localCache, previewMessage, bytes, { ...meta, mimeType });
            };

            for (const task of tasks) {
                if (runId !== mediaRunRef.current || chatBanned || !isActive || !chatPK || !chatPrivateKey) {
                    return;
                }
                await waitForMediaIdle(mediaConfig.stepDelayMs);
                if (runId !== mediaRunRef.current || chatBanned || !isActive || !chatPK || !chatPrivateKey || mediaAttemptsRef.current.has(task.key)) {
                    continue;
                }
                mediaAttemptsRef.current.add(task.key);
                try {
                    if (typeof preloadMessageMedia === 'function') {
                        await preloadMessageMedia(task.peerChatPK, task.message, readFile, {
                            readMessagePreview: readPreview,
                            writeMessagePreview: writePreview,
                            priority: task.priority,
                        });
                    } else {
                        await readFile(task.peerChatPK, task.message);
                    }
                } catch {}
            }
        },
        [buildMediaTasks, cloud, media, chatBanned, chatPK, chatPrivateKey, isActive, localCache, preloadMessageMedia, warming.media]
    );

    const scheduleMedia = useCallback(() => {
        const mediaConfig = warming.media;
        if (!mediaConfig.enabled || !isActive || !chatPK || !chatPrivateKey || chatBanned) {
            return;
        }
        if (mediaTimerRef.current) {
            clearTimeout(mediaTimerRef.current);
        }

        const runId = mediaRunRef.current + 1;
        mediaRunRef.current = runId;
        mediaTimerRef.current = setTimeout(() => {
            mediaTimerRef.current = null;
            void runMedia(runId);
        }, nonNegativeNumber(mediaConfig.startDelayMs, 0));
    }, [chatBanned, chatPK, chatPrivateKey, isActive, runMedia, warming.media]);

    const runBatchCleanup = useCallback(
        (entry, options = {}) => {
            runMessageBatchCleanup({
                entry,
                options,
                chatBanned,
                isActive,
                chatPK,
                deleteMessages,
                markMessagesHidden,
                diag,
                onExpire,
                getCurrentEntry: (chatId) => batchesRef.current.get(chatId),
                notifyPreviewDrop,
                notify,
            });
        },
        [chatBanned, chatPK, deleteMessages, diag, isActive, markMessagesHidden, notify, onExpire]
    );

    const ensureMessageBatch = useCallback(
        (chatId, options = {}) => {
            const source = options.source || 'route';
            const pageSize = positiveNumber(options.pageSize, warming.pageSize);
            const chatItem = listRef.current?.find?.((item) => item?.id === chatId) || null;
            const peerChatPK = options.peerChatPK || getChatPeerPK(chatItem, chatPK);
            const actors = options.actors || chatItem?.actors || null;
            const hasChatPreviewKey = Object.prototype.hasOwnProperty.call(options, 'chatPreviewKey');
            const chatPreviewKey = hasChatPreviewKey ? (options.chatPreviewKey ?? null) : undefined;
            const generation = generationRef.current;

            if (chatBanned || !isActive || !chatId || !chatPK || !chatPrivateKey || !peerChatPK || pendingDeleteIdsRef.current.has(chatId)) {
                return null;
            }

            const existing = batchesRef.current.get(chatId);
            let route = source === 'route';
            let warm = source === 'warm';
            let subscribers = new Set();
            let nextChatPreviewKey = chatPreviewKey ?? null;
            if (existing && existing.generation === generation) {
                const existingPageSize = Number(existing.pageSize) || 0;
                if (pageSize <= existingPageSize) {
                    existing.route = existing.route || route;
                    existing.warm = existing.warm || warm;
                    if (hasChatPreviewKey) {
                        existing.chatPreviewKey = chatPreviewKey ?? null;
                    }
                    if (!existing.route) {
                        const expiredMessages = trimExpiredEntry(existing);
                        if (expiredMessages.length) {
                            notifyPreviewDrop(onExpire, chatId, expiredMessages, existing.messages, chatPK, existing.peerChatPK);
                        }
                    }
                    notifyRetentionPreviewDrop(onExpire, chatId, existing.messages, chatPK, existing.peerChatPK);
                    if (existing.ready && isBatchFresh(existing)) {
                        onRead?.(chatId, existing.messages);
                    }
                    notify(existing);
                    scheduleTrim();
                    runBatchCleanup(existing, { hiddenCleanup: !existing.route, writeCheckpoint: false });
                    return makeMessageBatchSnapshot(existing);
                }

                route = existing.route || route;
                warm = existing.warm || warm;
                subscribers = new Set(existing.subscribers || []);
                nextChatPreviewKey = hasChatPreviewKey ? chatPreviewKey ?? null : existing.chatPreviewKey ?? null;
                try {
                    existing.unsub?.();
                } catch {}
                batchesRef.current.delete(chatId);
            }

            if (existing) {
                closeBatch(chatId);
            }

            const entry = {
                chatId,
                peerChatPK,
                pageSize,
                messages: [],
                olderThan: null,
                carry: null,
                hasOlder: false,
                hasMore: false,
                ready: false,
                loading: true,
                exists: false,
                unsub: null,
                startedAt: Date.now(),
                updatedAt: 0,
                chatPreviewKey: nextChatPreviewKey,
                batchPreviewKey: null,
                batchKeys: new Set(),
                expiredKeys: new Set(),
                deletedKeys: new Set(),
                autoDeleteState: { checkpointMs: 0, pendingCheckpointMs: 0 },
                generation,
                route,
                warm,
                subscribers,
            };

            batchesRef.current.set(chatId, entry);
            entry.unsub = listenToLatestMsgs(
                cloud,
                chatId,
                chatPK,
                chatPrivateKey,
                peerChatPK,
                pageSize,
                ({ messages, olderThan, carry, hasOlder, hasMore, fromCache, expiredKeys, deletedKeys }) => {
                    if (fromCache || batchesRef.current.get(chatId) !== entry || entry.generation !== generationRef.current) {
                        return;
                    }

                    const chatMessages = filterChatMessages(messages, chatPK, peerChatPK);
                    entry.messages = chatMessages;
                    entry.olderThan = olderThan ?? null;
                    entry.carry = carry ?? null;
                    entry.hasOlder = !!hasOlder;
                    entry.hasMore = !!hasMore;
                    entry.ready = true;
                    entry.loading = false;
                    entry.exists = true;
                    entry.updatedAt = Date.now();
                    entry.batchKeys = new Set(chatMessages.map(getMessageKey).filter(Boolean));
                    entry.batchPreviewKey = getBatchPreviewKey(chatMessages);
                    entry.expiredKeys = new Set(entry.expiredKeys || []);
                    entry.deletedKeys = new Set(deletedKeys || []);
                    const droppedKeys = new Set(entry.deletedKeys);
                    for (const key of expiredKeys || []) {
                        if (key) {
                            entry.expiredKeys.add(key);
                            droppedKeys.add(key);
                        }
                    }
                    notifyPreviewDrop(onExpire, chatId, droppedKeys, entry.messages, chatPK, peerChatPK);
                    notifyRetentionPreviewDrop(onExpire, chatId, entry.messages, chatPK, peerChatPK);
                    if (!entry.route) {
                        const expiredMessages = trimExpiredEntry(entry);
                        if (expiredMessages.length) {
                            notifyPreviewDrop(onExpire, chatId, expiredMessages, entry.messages, chatPK, peerChatPK);
                        }
                    }
                    if (isBatchFresh(entry)) {
                        onRead?.(chatId, entry.messages);
                    }
                    notify(entry);
                    scheduleMedia();
                    scheduleTrim();
                    runBatchCleanup(entry, { hiddenCleanup: !entry.route, writeCheckpoint: false });
                },
                (error) => {
                    if (batchesRef.current.get(chatId) !== entry || entry.generation !== generationRef.current) {
                        return;
                    }
                    entry.messages = [];
                    entry.olderThan = null;
                    entry.carry = null;
                    entry.hasOlder = false;
                    entry.hasMore = false;
                    entry.ready = true;
                    entry.loading = false;
                    entry.exists = false;
                    entry.updatedAt = Date.now();
                    entry.batchKeys = new Set();
                    entry.batchPreviewKey = null;
                    entry.expiredKeys = new Set();
                    entry.deletedKeys = new Set();
                    if (isDenied(error)) {
                        onUnavailable?.(chatId, error);
                    } else {
                        console.warn('Latest messages listener error', chatId, error);
                    }
                    notify(entry);
                },
                { actors }
            );

            notify(entry);
            return makeMessageBatchSnapshot(entry);
        },
        [cloud, chatBanned, chatPK, chatPrivateKey, closeBatch, isActive, notify, onExpire, onRead, onUnavailable, pendingDeleteIdsRef, runBatchCleanup, scheduleMedia, scheduleTrim, warming.pageSize]
    );

    const releaseMessageBatch = useCallback(
        (chatId, source = 'route', options = {}) => {
            const entry = batchesRef.current.get(chatId);
            if (!entry) {
                return;
            }
            if (!isActive && source === 'route') {
                notify(entry);
                return;
            }
            const wasRoute = source !== 'warm' && entry.route;
            if (source === 'warm') {
                entry.warm = false;
            } else {
                entry.route = false;
                mediaRunRef.current += 1;
            }
            if (!entry.route && entry.expiredKeys?.size) {
                notifyPreviewDrop(onExpire, chatId, entry.expiredKeys, entry.messages, chatPK, entry.peerChatPK);
            }
            if (!entry.route) {
                const expiredMessages = trimExpiredEntry(entry);
                if (expiredMessages.length) {
                    notifyPreviewDrop(onExpire, chatId, expiredMessages, entry.messages, chatPK, entry.peerChatPK);
                    notify(entry);
                }
            }
            runBatchCleanup(entry, {
                hiddenCleanup: !entry.route,
                keepKeys: options.keepKeys,
                writeCheckpoint: wasRoute && options.writeCheckpoint !== false,
            });
            scheduleTrim();
            maybeCloseBatch(entry);
        },
        [chatPK, isActive, maybeCloseBatch, notify, onExpire, runBatchCleanup, scheduleTrim]
    );

    const expireMessageBatch = useCallback(
        (chatId, messages) => {
            const entry = batchesRef.current.get(chatId);
            if (!entry) {
                return;
            }
            const removedMessages = removeEntryMessages(entry, messages);
            if (!removedMessages.length) {
                return;
            }
            notifyPreviewDrop(onExpire, chatId, removedMessages, entry.messages, chatPK, entry.peerChatPK);
            notify(entry);
            scheduleTrim();
            maybeCloseBatch(entry);
        },
        [maybeCloseBatch, notify, onExpire, scheduleTrim]
    );

    const subscribeMessageBatch = useCallback((chatId, callback) => {
        if (!chatId || typeof callback !== 'function') {
            return () => {};
        }
        const entry = batchesRef.current.get(chatId);
        if (!entry) {
            callback(null);
            return () => {};
        }
        entry.subscribers.add(callback);
        callback(makeMessageBatchSnapshot(entry));
        return () => {
            entry.subscribers.delete(callback);
        };
    }, []);

    const getMessageBatch = useCallback((chatId) => makeMessageBatchSnapshot(batchesRef.current.get(chatId)), []);
    const getMessageView = useCallback((scopeKey) => messageViewCacheRef.current.get(scopeKey), []);
    const rememberMessageView = useCallback((scopeKey, seed) => messageViewCacheRef.current.remember(scopeKey, seed), []);
    const updateMessageView = useCallback((scopeKey, update) => messageViewCacheRef.current.update(scopeKey, update), []);
    const retainMessageView = useCallback((scopeKey) => messageViewCacheRef.current.retain(scopeKey), []);
    const releaseMessageView = useCallback((scopeKey, onLeave) => messageViewCacheRef.current.release(scopeKey, onLeave), []);

    const waitForWarmTask = useCallback(
        (task) =>
            new Promise((resolve) => {
                const startedAt = Date.now();
                const taskData = { kind: task?.kind || '', pageSize: task?.pageSize || 0 };
                const finishTask = (result) => {
                    markDone(diag, 'chat.warm.task', startedAt, { ...taskData, ready: !!result });
                    resolve(result);
                };
                const failTask = (error) => {
                    markError(diag, 'chat.warm.task', startedAt, error, taskData);
                    resolve(false);
                };
                markDiag(diag, 'chat.warm.task.start', taskData);
                if (typeof task?.run === 'function') {
                    void Promise.resolve()
                        .then(() => task.run())
                        .then((result) => finishTask(!!result))
                        .catch(failTask);
                    return;
                }
                if (!task?.chatId) {
                    finishTask(false);
                    return;
                }

                const snapshot = ensureMessageBatch(task.chatId, {
                    source: 'warm',
                    peerChatPK: task.peerChatPK,
                    chatPreviewKey: task.chatPreviewKey,
                    pageSize: task.pageSize,
                });
                if (!snapshot || snapshot.ready || snapshot.exists === false) {
                    finishTask(!!snapshot);
                    return;
                }

                let done = false;
                let shouldUnsubscribe = false;
                let unsubscribe = () => {};
                const finishWait = (result) => {
                    if (done) {
                        return;
                    }
                    done = true;
                    shouldUnsubscribe = true;
                    unsubscribe();
                    finishTask(result);
                };

                unsubscribe = subscribeMessageBatch(task.chatId, (next) => {
                    if (!next || next.ready || next.exists === false) {
                        finishWait(!!next);
                    }
                });
                if (shouldUnsubscribe) {
                    unsubscribe();
                }
            }),
        [diag, ensureMessageBatch, subscribeMessageBatch]
    );

    const pumpWarmQueue = useCallback(
        function pumpWarmQueue() {
            if (warmJobRef.current || !warmQueueRef.current.length) {
                return;
            }

            const task = warmQueueRef.current.shift();
            if (!task) {
                return;
            }

            warmJobRef.current = { key: warmTaskKey(task) };
            void waitForWarmTask(task).finally(() => {
                if (warmJobRef.current?.key === warmTaskKey(task)) {
                    warmJobRef.current = null;
                }
                setTimeout(pumpWarmQueue, 0);
            });
        },
        [waitForWarmTask]
    );

    const queueMessagePreload = useCallback(
        (nextTasks, options = {}) => {
            const list = (Array.isArray(nextTasks) ? nextTasks : [nextTasks])
                .filter(Boolean)
                .map((task) => ({ ...task, kind: task.kind || 'custom' }))
                .filter((task) => warmTaskKey(task));
            if (!list.length) {
                return;
            }

            const currentKey = warmJobRef.current?.key || '';
            const seen = new Set([currentKey, ...warmQueueRef.current.map(warmTaskKey)].filter(Boolean));
            const unique = [];
            for (const task of list) {
                const key = warmTaskKey(task);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                unique.push(task);
            }
            if (!unique.length) {
                return;
            }

            warmQueueRef.current = options.front === false ? [...warmQueueRef.current, ...unique] : [...unique, ...warmQueueRef.current];
            pumpWarmQueue();
        },
        [pumpWarmQueue]
    );

    const warmList = useCallback(
        (chats, limit) => {
            if (!warming.enabled || !isActive || !chatPK || !chatPrivateKey || chatBanned) {
                return false;
            }

            const candidates = warmCandidates(chats, chatPK, pendingDeleteIdsRef.current, limit);
            const candidateKey = candidates.map((chatItem) => chatItem.id).join('|');
            const warmKey = `${limit}:${warming.pageSize}:${candidateKey}`;
            const lastWarmKeys = warmKeyStore(lastWarmKeyRef);
            if (warmKey === lastWarmKeys.get(limit)) {
                return false;
            }
            lastWarmKeys.set(limit, warmKey);
            const desired = new Set(candidates.map((chatItem) => chatItem.id));
            warmIdsRef.current = candidates.map((chatItem) => chatItem.id);
            const currentKey = warmJobRef.current?.key || '';
            const tasks = [];

            for (const chatItem of candidates) {
                const peerChatPK = getChatPeerPK(chatItem, chatPK);
                if (!peerChatPK) {
                    continue;
                }
                const task = {
                    kind: 'latest',
                    chatId: chatItem.id,
                    peerChatPK,
                    chatPreviewKey: getChatPreviewKey(chatItem),
                    pageSize: warming.pageSize,
                };
                const key = warmTaskKey(task);
                const entry = batchesRef.current.get(chatItem.id);
                const ready = entry?.ready && Number(entry.pageSize || 0) >= task.pageSize && isBatchFresh(entry);
                if (!ready && key !== currentKey) {
                    tasks.push(task);
                }
            }
            markDiag(diag, 'chat.warm.queue', { candidateCount: candidates.length, taskCount: tasks.length, limit, pageSize: warming.pageSize });
            const preserved = warmQueueRef.current.filter((task) => task?.kind !== 'latest');
            warmQueueRef.current = [...preserved, ...tasks];
            pumpWarmQueue();

            for (const [chatId, entry] of batchesRef.current.entries()) {
                if (entry.warm && !desired.has(chatId)) {
                    releaseMessageBatch(chatId, 'warm');
                }
            }
            return true;
        },
        [chatBanned, chatPK, chatPrivateKey, diag, isActive, pendingDeleteIdsRef, pumpWarmQueue, releaseMessageBatch, warming.enabled, warming.pageSize]
    );

    const warm = useCallback(
        (chats) => {
            if (!warming.enabled) {
                return;
            }
            if (warmTimerRef.current) {
                clearTimeout(warmTimerRef.current);
                warmTimerRef.current = null;
            }

            const list = Array.isArray(chats) ? chats : listRef.current || [];
            const runWarm = (limit, phase) => {
                if (warmList(list, limit)) {
                    markDiag(diag, 'chat.warm.start', { chatCount: list.length, phase, eagerCount: warming.eagerCount, count: warming.count, delayMs: warming.delayMs });
                    scheduleMedia();
                }
            };
            if (warming.eagerCount > 0) {
                runWarm(warming.eagerCount, 'eager');
            }
            if (warming.count > warming.eagerCount) {
                warmTimerRef.current = setTimeout(() => {
                    warmTimerRef.current = null;
                    runWarm(warming.count, 'delayed');
                }, warming.delayMs);
            }
        },
        [diag, listRef, scheduleMedia, warmList, warming.count, warming.delayMs, warming.eagerCount, warming.enabled]
    );

    return {
        clear,
        closeBatch,
        ensureMessageBatch,
        getMessageBatch,
        expireMessageBatch,
        releaseMessageBatch,
        subscribeMessageBatch,
        queueMessagePreload,
        getMessageView,
        rememberMessageView,
        updateMessageView,
        retainMessageView,
        releaseMessageView,
        warm,
    };
}
