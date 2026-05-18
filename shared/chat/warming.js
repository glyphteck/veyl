'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { readCachedMedia, writeCachedMedia } from '../localdatacache.js';
import { saveMedia } from './attachments.js';
import { makeMessagePreviewMedia, MESSAGE_PREVIEW_MIME } from './previews.js';
import { getMessageKey } from './state.js';
import { filterChatMessages, getChatPeerPK, getChatRowLastMsgKey, getPeerChatPKFromChatId, MSG_BATCH_SIZE } from './utils.js';

const DEFAULT_MEDIA_WARMING = Object.freeze({
    enabled: false,
    chatCount: 10,
    messagesPerChat: 20,
    startDelayMs: 600,
    stepDelayMs: 120,
    types: ['img', 'mp4'],
    maxBytes: 0,
});

export const DEFAULT_CHAT_WARMING = Object.freeze({
    enabled: false,
    eagerCount: 5,
    count: 10,
    delayMs: 900,
    pageSize: MSG_BATCH_SIZE,
    media: DEFAULT_MEDIA_WARMING,
});

function count(value, fallback) {
    const next = Number(value);
    return Number.isFinite(next) && next >= 0 ? next : fallback;
}

function positive(value, fallback) {
    const next = Number(value);
    return Number.isFinite(next) && next > 0 ? next : fallback;
}

function normalizeMediaWarming(media, chatCount) {
    if (!media) {
        return DEFAULT_MEDIA_WARMING;
    }
    if (media === true) {
        return { ...DEFAULT_MEDIA_WARMING, enabled: true, chatCount };
    }
    const types = Array.isArray(media.types) && media.types.length ? media.types.map((type) => String(type || '').trim()).filter(Boolean) : DEFAULT_MEDIA_WARMING.types;
    return {
        ...DEFAULT_MEDIA_WARMING,
        ...media,
        enabled: media.enabled !== false,
        chatCount: count(media.chatCount, chatCount),
        messagesPerChat: positive(media.messagesPerChat, DEFAULT_MEDIA_WARMING.messagesPerChat),
        startDelayMs: count(media.startDelayMs, DEFAULT_MEDIA_WARMING.startDelayMs),
        stepDelayMs: count(media.stepDelayMs, DEFAULT_MEDIA_WARMING.stepDelayMs),
        types,
    };
}

export function normalizeChatWarming(warming) {
    if (!warming) {
        return DEFAULT_CHAT_WARMING;
    }
    const config =
        warming === true
            ? { ...DEFAULT_CHAT_WARMING, enabled: true }
            : {
                  ...DEFAULT_CHAT_WARMING,
                  ...warming,
                  enabled: warming.enabled !== false,
              };
    const warmCount = count(config.count, DEFAULT_CHAT_WARMING.count);
    const eagerCount = Math.min(count(config.eagerCount, DEFAULT_CHAT_WARMING.eagerCount), warmCount);
    return {
        ...config,
        count: warmCount,
        eagerCount,
        delayMs: count(config.delayMs, DEFAULT_CHAT_WARMING.delayMs),
        pageSize: positive(config.pageSize, DEFAULT_CHAT_WARMING.pageSize),
        media: normalizeMediaWarming(config.media, warmCount),
    };
}

function getBatchLastMsgKey(messages) {
    const last = messages?.length ? messages[messages.length - 1] : null;
    return getMessageKey(last);
}

function isBatchFresh(entry) {
    return !entry?.rowLastMsgKey || entry.batchKeys?.has?.(entry.rowLastMsgKey);
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
        generation: entry.generation,
        adoptable: !!entry.ready && isBatchFresh(entry),
    };
}

function isRemoteMediaMessage(message, mediaConfig) {
    const path = typeof message?.p === 'string' ? message.p.trim() : '';
    const fileKey = typeof message?.k === 'string' ? message.k.trim() : '';
    if (!path || !fileKey || path.startsWith('local:') || fileKey === 'local' || message?.pending || message?.failed) {
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

export function useChatWarming({ chat, chatPK, chatPrivateKey, chatBanned, isActive, localCache, rowsRef, pendingDeleteIdsRef, config, preloadMessageMedia, onRead }) {
    const batchesRef = useRef(new Map());
    const generationRef = useRef(0);
    const warmTimerRef = useRef(null);
    const mediaTimerRef = useRef(null);
    const mediaRunRef = useRef(0);
    const mediaAttemptsRef = useRef(new Set());
    const warmIdsRef = useRef([]);
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
                    if (existing.ready && isBatchFresh(existing)) {
                        onRead?.(chatId, existing.messages);
                    }
                    notify(existing);
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
                ({ messages, cursor, carry, hasOlder, hasMore, fromCache }) => {
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
                    if (isBatchFresh(entry)) {
                        onRead?.(chatId, chatMessages);
                    }
                    notify(entry);
                    scheduleMedia();
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
                    if (error?.code !== 'permission-denied') {
                        console.warn('Latest messages listener error', chatId, error);
                    }
                    notify(entry);
                }
            );

            notify(entry);
            return makeSnapshot(entry);
        },
        [chat, chatBanned, chatPK, chatPrivateKey, closeBatch, isActive, notify, onRead, pendingDeleteIdsRef, scheduleMedia, warming.pageSize]
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
            }
            maybeCloseBatch(entry);
        },
        [isActive, maybeCloseBatch, notify]
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

    const warmRows = useCallback(
        (rows, limit) => {
            if (!warming.enabled || !isActive || !chatPK || !chatPrivateKey || chatBanned) {
                return;
            }

            const candidates = warmCandidates(rows, chatPK, pendingDeleteIdsRef.current, limit);
            const desired = new Set(candidates.map((chatItem) => chatItem.id));
            warmIdsRef.current = candidates.map((chatItem) => chatItem.id);

            for (const chatItem of candidates) {
                const peerChatPK = getChatPeerPK(chatItem, chatPK);
                if (!peerChatPK) {
                    continue;
                }
                ensureMessageBatch(chatItem.id, {
                    source: 'warm',
                    peerChatPK,
                    rowLastMsgKey: getChatRowLastMsgKey(chatItem),
                    pageSize: warming.pageSize,
                });
            }

            for (const [chatId, entry] of batchesRef.current.entries()) {
                if (entry.warm && !desired.has(chatId)) {
                    releaseMessageBatch(chatId, 'warm');
                }
            }
        },
        [chatBanned, chatPK, chatPrivateKey, ensureMessageBatch, isActive, pendingDeleteIdsRef, releaseMessageBatch, warming.enabled, warming.pageSize]
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
        [rowsRef, scheduleMedia, warmRows, warming.count, warming.delayMs, warming.eagerCount, warming.enabled]
    );

    return {
        clear,
        closeBatch,
        ensureMessageBatch,
        getMessageBatch,
        releaseMessageBatch,
        subscribeMessageBatch,
        warm,
    };
}
