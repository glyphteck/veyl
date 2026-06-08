'use client';

import { LOCAL_CHAT_CACHE_MAX_ITEMS } from '../../config.js';
import { timestampMs } from '../../utils/time.js';
import { isCurrentChatCacheEntry } from '../../chat/chats.js';
import { collectMediaIds } from './media.js';
import { isObject, jsonClean, reviveTs } from './schema.js';

function serializeMsg(msg) {
    if (!isObject(msg)) {
        return null;
    }

    const { pending, failed, localUri, localData, type, ...rest } = msg;
    const clean = jsonClean(rest);
    const ts = timestampMs(msg.ts, null, { positive: true });
    if (ts != null) {
        clean.ts = ts;
    } else {
        delete clean.ts;
    }
    const ttl = timestampMs(msg.ttl, null, { positive: true });
    if (ttl != null) {
        clean.ttl = ttl;
    } else if (msg.ttl == null && 'ttl' in msg) {
        clean.ttl = null;
    } else {
        delete clean.ttl;
    }
    return clean;
}

function reviveMsg(msg) {
    if (!isObject(msg)) {
        return null;
    }

    const next = {
        ...msg,
        ts: reviveTs(msg.ts),
    };
    if ('ttl' in msg) {
        next.ttl = msg.ttl == null ? null : reviveTs(msg.ttl);
    }
    return next;
}

function serializeChat(chat) {
    if (!chat?.id) {
        return null;
    }

    return {
        id: chat.id,
        linkId: chat.linkId || null,
        entryId: chat.entryId || null,
        peerChatPK: chat.peerChatPK || null,
        peerUid: chat.peerUid || null,
        actors: isObject(chat.actors) ? jsonClean(chat.actors) : undefined,
        settings: isObject(chat.settings) ? jsonClean(chat.settings) : undefined,
        preview: serializeMsg(chat.preview),
        readMs: timestampMs(chat.readMs, null, { positive: true }) || null,
        ts: timestampMs(chat.ts, null, { positive: true }) || 0,
        lastUsedAt: Date.now(),
        unseen: !!chat.unseen,
    };
}

function reviveChat(chat) {
    if (!chat?.id) {
        return null;
    }

    const preview = reviveMsg(chat.preview);
    return {
        id: chat.id,
        linkId: chat.linkId || null,
        entryId: chat.entryId || null,
        peerChatPK: chat.peerChatPK || null,
        peerUid: chat.peerUid || null,
        actors: isObject(chat.actors) ? chat.actors : undefined,
        settings: isObject(chat.settings) ? chat.settings : undefined,
        preview,
        readMs: timestampMs(chat.readMs, null, { positive: true }),
        ts: timestampMs(chat.ts, null, { positive: true }) || 0,
        lastUsedAt: timestampMs(chat.lastUsedAt, null, { positive: true }) || 0,
        unseen: !!chat.unseen,
    };
}

function chatRecencyMs(chat) {
    return timestampMs(chat?.ts, null, { positive: true }) || timestampMs(chat?.lastUsedAt, null, { positive: true }) || 0;
}

function compareCachedChats(a, b) {
    const delta = chatRecencyMs(b) - chatRecencyMs(a);
    if (delta !== 0) return delta;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function cappedCachedChats(chats) {
    return (chats || []).slice().sort(compareCachedChats).slice(0, LOCAL_CHAT_CACHE_MAX_ITEMS);
}

function chatMap(chats) {
    const next = {};
    for (const chat of cappedCachedChats(chats)) {
        if (chat?.id) {
            next[chat.id] = chat;
        }
    }
    return next;
}

function collectRemovedChatMediaIds(currentPayload, nextById) {
    const mediaIds = [];
    const chatsById = currentPayload?.chatsById;
    if (!isObject(chatsById)) {
        return mediaIds;
    }
    for (const [chatId, chat] of Object.entries(chatsById)) {
        if (!nextById?.[chatId] && chat?.preview) {
            mediaIds.push(...collectMediaIds(currentPayload, [chat.preview]));
        }
    }
    return mediaIds;
}

export function readCachedChats(cache) {
    const payload = cache?.read?.();
    if (!payload?.chatsById) {
        return [];
    }
    const chats = Object.entries(payload.chatsById)
        .map(([id, value]) => {
            const chat = reviveChat(value);
            if (!chat || !isCurrentChatCacheEntry(chat)) {
                return null;
            }
            return chat;
        })
        .filter(Boolean)
        .sort(compareCachedChats);
    const cappedChats = cappedCachedChats(chats);
    const cappedIds = new Set(cappedChats.map((chat) => chat.id));
    const dropIds = chats.map((chat) => chat.id).filter((id) => !cappedIds.has(id));
    if (dropIds.length) {
        dropCachedChats(cache, dropIds, payload);
    }
    return cappedChats;
}

export function writeCachedChats(cache, chats) {
    if (!cache?.patch || !Array.isArray(chats)) {
        return;
    }

    const items = [];
    for (const chat of chats) {
        const item = serializeChat(chat);
        if (item?.id && item.ts && isCurrentChatCacheEntry(item)) {
            items.push(item);
        }
    }

    let mediaIds = [];
    void cache.patch((payload) => {
        const byId = new Map();
        for (const chat of Object.values(payload.chatsById || {}).map(reviveChat).filter(Boolean)) {
            byId.set(chat.id, chat);
        }
        for (const item of items) {
            byId.set(item.id, item);
        }
        const next = chatMap([...byId.values()]);
        mediaIds = collectRemovedChatMediaIds(payload, next);
        payload.chatsById = next;
        payload.chatsSavedAt = Date.now();
        return payload;
    }).then(() => cache.removeMediaIds?.(mediaIds));
}

function dropCachedChats(cache, chatIds, currentPayload = null) {
    if (!cache?.patch || !chatIds?.length) {
        return;
    }

    const mediaIds = [];
    const current = currentPayload || cache.read?.();
    for (const chatId of chatIds) {
        const preview = current?.chatsById?.[chatId]?.preview;
        if (preview) {
            mediaIds.push(...collectMediaIds(current, [preview]));
        }
    }

    void cache.patch((payload) => {
        for (const chatId of chatIds) {
            delete payload.chatsById?.[chatId];
        }
        return payload;
    }).then(() => cache.removeMediaIds?.(mediaIds));
}

export function dropCachedChat(cache, chatId) {
    if (!cache?.patch || !chatId) {
        return;
    }

    dropCachedChats(cache, [chatId]);
}
