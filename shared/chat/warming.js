'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { readCachedMedia, writeCachedMedia } from '../localdatacache.js';
import { saveMedia } from './attachments.js';
import { hasStoredFileRef, isExpiredAttachmentMsg, isExpiredMsg } from './messages.js';
import { makeMessagePreviewMedia, MESSAGE_PREVIEW_MIME } from './previews.js';
import { getMessageKey } from './state.js';
import { ttlMillis } from './ttl.js';
import { filterChatMessages, getChatPeerPK, getChatRowLastMsgKey, getPeerChatPKFromChatId } from './utils.js';
import { DEFAULT_CHAT_WARMING, normalizeChatWarming, positive } from './warmingconfig.js';

function getBatchLastMsgKey(messages) {
    const last = messages?.length ? messages[messages.length - 1] : null;
    return getMessageKey(last);
}

function isBatchFresh(entry) {
    return !entry?.rowLastMsgKey || entry.batchKeys?.has?.(entry.rowLastMsgKey) || entry.expiredKeys?.has?.(entry.rowLastMsgKey) || (entry.ready && !entry.hasOlder && !entry.hasMore);
}

function makeSnapshot(entry) {
    if (!entry) {
        return null;
    }
    return {
        chatId: entry.chatId,
        messages: entry.messages || [],
        cursor: entry.cursor ?? null,
        carry: entry.carry ?? null,
        hasOlder: !!entry.hasOlder,
        hasMore: !!entry.hasMore,
        ready: !!entry.ready,
        loading: !!entry.loading,
        exists: !!entry.exists,
        fromCache: false,
        rowLastMsgKey: entry.rowLastMsgKey ?? null,
        batchLastMsgKey: entry.batchLastMsgKey ?? null,
        expiredKeys: new Set(entry.expiredKeys || []),
        deletedKeys: new Set(entry.deletedKeys || []),
        generation: entry.generation,
        adoptable: !!entry.ready && isBatchFresh(entry),
    };
}

function isRemoteMediaMessage(message, mediaConfig) {
    const path = typeof message?.p === 'string' ? message.p.trim() : '';
    const fileKey = typeof message?.k === 'string' ? message.k.trim() : '';
    if (!path || !fileKey || path.startsWith('local:') || fileKey === 'local' || message?.pending || message?.failed || isExpiredAttachmentMsg(message) || !hasStoredFileRef(message)) {
        return false;
    }

    const type = String(message?.t || '');
    if (!mediaConfig.types.includes(type)) {
        return false;
    }

    const maxBytes = Number(mediaConfig.maxBytes);
    const size = Number(message?.z);
    return !(Number.isFinite(maxBytes) && maxBytes > 0 && Number.isFinite(size) && size > maxBytes);
}

function mediaKey(peerChatPK, message) {
    return `${peerChatPK || ''}:${message?.t || ''}:${message?.p || ''}:${message?.k || ''}`;
}

function waitForIdle(delayMs) {
    return new Promise((resolve) => {
        if (typeof globalThis.requestIdleCallback === 'function') {
            globalThis.requestIdleCallback(() => resolve(), { timeout: Math.max(50, Number(delayMs) || 0) });
            return;
        }
        setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
    });
}

function warmCandidates(rows, chatPK, pendingDeleteIds, limit) {
    return (Array.isArray(rows) ? rows : [])
        .filter((chatItem) => chatItem?.id && !pendingDeleteIds.has(chatItem.id) && Array.isArray(chatItem.participants) && chatItem.participants.includes(chatPK))
        .slice(0, Math.max(0, limit));
}

function warmTaskKey(task) {
    if (task?.key) {
        return String(task.key);
    }
    return `${task?.chatId || ''}:${task?.pageSize || 0}`;
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

function messageHasKey(message, keys) {
    if (!message || !keys?.size) {
        return false;
    }
    const key = getMessageKey(message);
    const id = typeof message.id === 'string' ? message.id.trim() : '';
    const cid = typeof message.cid === 'string' ? message.cid.trim() : '';
    return !!((key && keys.has(key)) || (id && keys.has(id)) || (cid && keys.has(cid)));
}

function trimExpiredEntry(entry, now = Date.now()) {
    if (!entry?.messages?.length) {
        return [];
    }

    const messages = [];
    const expiredKeys = new Set(entry.expiredKeys || []);
    const expiredMessages = [];
    let changed = false;
    for (const message of entry.messages) {
        if (isExpiredMsg(message, now)) {
            addMessageKeys(expiredKeys, message);
            expiredMessages.push(message);
            changed = true;
        } else {
            messages.push(message);
        }
    }
    if (!changed) {
        return [];
    }

    entry.messages = messages;
    entry.expiredKeys = expiredKeys;
    entry.batchKeys = new Set(messages.map(getMessageKey).filter(Boolean));
    entry.batchLastMsgKey = getBatchLastMsgKey(messages);
    return expiredMessages;
}

function removeEntryMessages(entry, messages) {
    if (!entry?.messages?.length) {
        return [];
    }
    const keys = new Set();
    for (const message of messages || []) {
        addMessageKeys(keys, message);
    }
    if (!keys.size) {
        return [];
    }

    const nextMessages = [];
    const expiredKeys = new Set(entry.expiredKeys || []);
    const removedMessages = [];
    let changed = false;
    for (const message of entry.messages) {
        if (messageHasKey(message, keys)) {
            addMessageKeys(expiredKeys, message);
            removedMessages.push(message);
            changed = true;
        } else {
            nextMessages.push(message);
        }
    }
    if (!changed) {
        return [];
    }

    entry.messages = nextMessages;
    entry.expiredKeys = expiredKeys;
    entry.batchKeys = new Set(nextMessages.map(getMessageKey).filter(Boolean));
    entry.batchLastMsgKey = getBatchLastMsgKey(nextMessages);
    return removedMessages;
}

function nextTrimMs(entries, now = Date.now()) {
    let next = Infinity;
    for (const entry of entries || []) {
        if (entry?.route || !entry?.messages?.length) {
            continue;
        }
        for (const message of entry.messages) {
            const ms = ttlMillis(message?.ttl);
            if (ms != null && ms > now && ms < next) {
                next = ms;
            }
        }
    }
    return Number.isFinite(next) ? next : null;
}

function markDiag(diag, label, data) {
    try {
        diag?.(label, data);
    } catch {}
}

function markDone(diag, label, startedAt, data = {}) {
    markDiag(diag, `${label}.done`, { ...data, elapsedMs: Date.now() - startedAt });
}

function markError(diag, label, startedAt, error, data = {}) {
    markDiag(diag, `${label}.error`, { ...data, elapsedMs: Date.now() - startedAt, code: error?.code || '', message: error?.message || String(error) });
}

export function useChatWarming({ chat, chatPK, chatPrivateKey, chatBanned, isActive, localCache, rowsRef, pendingDeleteIdsRef, config, preloadMessageMedia, onRead, onExpire, diag = null }) {
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
    const warming = useMemo(() => normalizeChatWarming(config), [config]);

    useEffect(() => {
        mediaAttemptsRef.current.clear();
    }, [chatPK, localCache?.id]);

    const notify = useCallback((entry) => {
        const snapshot = makeSnapshot(entry);
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
            onExpire?.(entry.chatId, expiredMessages);
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

        const ids = warmIdsRef.current.slice(0, Math.max(0, mediaConfig.chatCount));
        const tasks = [];
        const queued = new Set();
        for (const [chatIndex, chatId] of ids.entries()) {
            const entry = batchesRef.current.get(chatId);
            if (!entry?.ready || !entry.exists || !entry.messages?.length || !entry.peerChatPK) {
                continue;
            }
            const messages = filterChatMessages(entry.messages, chatPK, entry.peerChatPK).slice().reverse().slice(0, mediaConfig.messagesPerChat);
            for (const [messageIndex, message] of messages.entries()) {
                if (!isRemoteMediaMessage(message, mediaConfig)) {
                    continue;
                }
                const key = mediaKey(entry.peerChatPK, message);
                if (!key || queued.has(key) || mediaAttemptsRef.current.has(key)) {
                    continue;
                }
                queued.add(key);
                tasks.push({ key, message, peerChatPK: entry.peerChatPK, priority: chatIndex === 0 ? 3 : 1, rank: chatIndex * 1000 + messageIndex });
            }
        }
        return tasks.sort((a, b) => a.rank - b.rank);
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

                const bytes = await chat.readMessageFile(chatPK, chatPrivateKey, peerChatPK, message);
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
                await waitForIdle(mediaConfig.stepDelayMs);
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
        [buildMediaTasks, chat, chatBanned, chatPK, chatPrivateKey, isActive, localCache, preloadMessageMedia, warming.media]
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
        }, Math.max(0, Number(mediaConfig.startDelayMs) || 0));
    }, [chatBanned, chatPK, chatPrivateKey, isActive, runMedia, warming.media]);

    const ensureMessageBatch = useCallback(
        (chatId, options = {}) => {
            const source = options.source || 'route';
            const pageSize = positive(options.pageSize, warming.pageSize);
            const peerChatPK = options.peerChatPK || getPeerChatPKFromChatId(chatId, chatPK);
            const hasRowLastMsgKey = Object.prototype.hasOwnProperty.call(options, 'rowLastMsgKey');
            const rowLastMsgKey = hasRowLastMsgKey ? (options.rowLastMsgKey ?? null) : undefined;
            const generation = generationRef.current;

            if (chatBanned || !isActive || !chatId || !chatPK || !chatPrivateKey || !peerChatPK || pendingDeleteIdsRef.current.has(chatId)) {
                return null;
            }

            const existing = batchesRef.current.get(chatId);
            let route = source === 'route';
            let warm = source === 'warm';
            let subscribers = new Set();
            let nextRowLastMsgKey = rowLastMsgKey ?? null;
            if (existing && existing.generation === generation) {
                const existingPageSize = Number(existing.pageSize) || 0;
                if (pageSize <= existingPageSize) {
                    existing.route = existing.route || route;
                    existing.warm = existing.warm || warm;
                    if (hasRowLastMsgKey) {
                        existing.rowLastMsgKey = rowLastMsgKey ?? null;
                    }
                    if (!existing.route) {
                        const expiredMessages = trimExpiredEntry(existing);
                        if (expiredMessages.length) {
                            onExpire?.(chatId, expiredMessages);
                        }
                    }
                    if (existing.ready && isBatchFresh(existing)) {
                        onRead?.(chatId, existing.messages);
                    }
                    notify(existing);
                    scheduleTrim();
                    return makeSnapshot(existing);
                }

                route = existing.route || route;
                warm = existing.warm || warm;
                subscribers = new Set(existing.subscribers || []);
                nextRowLastMsgKey = hasRowLastMsgKey ? rowLastMsgKey ?? null : existing.rowLastMsgKey ?? null;
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
                cursor: null,
                carry: null,
                hasOlder: false,
                hasMore: false,
                ready: false,
                loading: true,
                exists: false,
                unsub: null,
                startedAt: Date.now(),
                updatedAt: 0,
                rowLastMsgKey: nextRowLastMsgKey,
                batchLastMsgKey: null,
                batchKeys: new Set(),
                expiredKeys: new Set(),
                deletedKeys: new Set(),
                generation,
                route,
                warm,
                subscribers,
            };

            batchesRef.current.set(chatId, entry);
            entry.unsub = chat.listenToLatestMessages(
                chatId,
                chatPK,
                chatPrivateKey,
                peerChatPK,
                pageSize,
                ({ messages, cursor, carry, hasOlder, hasMore, fromCache, expiredKeys, deletedKeys }) => {
                    if (fromCache || batchesRef.current.get(chatId) !== entry || entry.generation !== generationRef.current) {
                        return;
                    }

                    const chatMessages = filterChatMessages(messages, chatPK, peerChatPK);
                    entry.messages = chatMessages;
                    entry.cursor = cursor ?? null;
                    entry.carry = carry ?? null;
                    entry.hasOlder = !!hasOlder;
                    entry.hasMore = !!hasMore;
                    entry.ready = true;
                    entry.loading = false;
                    entry.exists = true;
                    entry.updatedAt = Date.now();
                    entry.batchKeys = new Set(chatMessages.map(getMessageKey).filter(Boolean));
                    entry.batchLastMsgKey = getBatchLastMsgKey(chatMessages);
                    entry.expiredKeys = new Set(entry.expiredKeys || []);
                    entry.deletedKeys = new Set(deletedKeys || []);
                    for (const key of expiredKeys || []) {
                        if (key) {
                            entry.expiredKeys.add(key);
                        }
                    }
                    if (!entry.route && expiredKeys?.length) {
                        onExpire?.(chatId, expiredKeys);
                    }
                    if (!entry.route) {
                        const expiredMessages = trimExpiredEntry(entry);
                        if (expiredMessages.length) {
                            onExpire?.(chatId, expiredMessages);
                        }
                    }
                    if (isBatchFresh(entry)) {
                        onRead?.(chatId, entry.messages);
                    }
                    notify(entry);
                    scheduleMedia();
                    scheduleTrim();
                },
                (error) => {
                    if (batchesRef.current.get(chatId) !== entry || entry.generation !== generationRef.current) {
                        return;
                    }
                    entry.messages = [];
                    entry.cursor = null;
                    entry.carry = null;
                    entry.hasOlder = false;
                    entry.hasMore = false;
                    entry.ready = true;
                    entry.loading = false;
                    entry.exists = false;
                    entry.updatedAt = Date.now();
                    entry.batchKeys = new Set();
                    entry.batchLastMsgKey = null;
                    entry.expiredKeys = new Set();
                    entry.deletedKeys = new Set();
                    if (error?.code !== 'permission-denied') {
                        console.warn('Latest messages listener error', chatId, error);
                    }
                    notify(entry);
                }
            );

            notify(entry);
            return makeSnapshot(entry);
        },
        [chat, chatBanned, chatPK, chatPrivateKey, closeBatch, isActive, notify, onExpire, onRead, pendingDeleteIdsRef, scheduleMedia, scheduleTrim, warming.pageSize]
    );

    const releaseMessageBatch = useCallback(
        (chatId, source = 'route') => {
            const entry = batchesRef.current.get(chatId);
            if (!entry) {
                return;
            }
            if (!isActive && source === 'route') {
                notify(entry);
                return;
            }
            if (source === 'warm') {
                entry.warm = false;
            } else {
                entry.route = false;
                mediaRunRef.current += 1;
            }
            if (!entry.route && entry.expiredKeys?.size) {
                onExpire?.(chatId, entry.expiredKeys);
            }
            if (!entry.route) {
                const expiredMessages = trimExpiredEntry(entry);
                if (expiredMessages.length) {
                    onExpire?.(chatId, expiredMessages);
                    notify(entry);
                }
            }
            scheduleTrim();
            maybeCloseBatch(entry);
        },
        [isActive, maybeCloseBatch, notify, onExpire, scheduleTrim]
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
            onExpire?.(chatId, removedMessages);
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
        callback(makeSnapshot(entry));
        return () => {
            entry.subscribers.delete(callback);
        };
    }, []);

    const getMessageBatch = useCallback((chatId) => makeSnapshot(batchesRef.current.get(chatId)), []);

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
                    rowLastMsgKey: task.rowLastMsgKey,
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

    const warmRows = useCallback(
        (rows, limit) => {
            if (!warming.enabled || !isActive || !chatPK || !chatPrivateKey || chatBanned) {
                return;
            }

            const candidates = warmCandidates(rows, chatPK, pendingDeleteIdsRef.current, limit);
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
                    rowLastMsgKey: getChatRowLastMsgKey(chatItem),
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
        },
        [chatBanned, chatPK, chatPrivateKey, diag, isActive, pendingDeleteIdsRef, pumpWarmQueue, releaseMessageBatch, warming.enabled, warming.pageSize]
    );

    const warm = useCallback(
        (rows) => {
            if (!warming.enabled) {
                return;
            }
            if (warmTimerRef.current) {
                clearTimeout(warmTimerRef.current);
                warmTimerRef.current = null;
            }

            const list = Array.isArray(rows) ? rows : rowsRef.current || [];
            markDiag(diag, 'chat.warm.start', { rowCount: list.length, eagerCount: warming.eagerCount, count: warming.count, delayMs: warming.delayMs });
            warmRows(list, warming.eagerCount);
            scheduleMedia();
            if (warming.count > warming.eagerCount) {
                warmTimerRef.current = setTimeout(() => {
                    warmTimerRef.current = null;
                    warmRows(list, warming.count);
                    scheduleMedia();
                }, warming.delayMs);
            }
        },
        [diag, rowsRef, scheduleMedia, warmRows, warming.count, warming.delayMs, warming.eagerCount, warming.enabled]
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
        warm,
    };
}
