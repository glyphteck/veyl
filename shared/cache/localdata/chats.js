'use client';

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
        lastMsg: serializeMsg(chat.lastMsg),
        readMs: timestampMs(chat.readMs, null, { positive: true }) || null,
        ts: timestampMs(chat.ts, null, { positive: true }) || 0,
        unseen: !!chat.unseen,
    };
}

function reviveChat(chat) {
    if (!chat?.id) {
        return null;
    }

    const lastMsg = reviveMsg(chat.lastMsg);
    return {
        id: chat.id,
        linkId: chat.linkId || null,
        entryId: chat.entryId || null,
        peerChatPK: chat.peerChatPK || null,
        peerUid: chat.peerUid || null,
        actors: isObject(chat.actors) ? chat.actors : undefined,
        settings: isObject(chat.settings) ? chat.settings : undefined,
        lastMsg,
        readMs: timestampMs(chat.readMs, null, { positive: true }),
        ts: timestampMs(chat.ts, null, { positive: true }) || 0,
        unseen: !!chat.unseen,
    };
}

export function readCachedChats(cache) {
    const payload = cache?.read?.();
    if (!payload?.chatsById) {
        return [];
    }
    const invalidIds = [];
    const chats = Object.entries(payload.chatsById)
        .map(([id, value]) => {
            const chat = reviveChat(value);
            if (!chat || !isCurrentChatCacheEntry(chat)) {
                invalidIds.push(id);
                return null;
            }
            return chat;
        })
        .filter(Boolean)
        .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (invalidIds.length) {
        dropCachedChats(cache, invalidIds, payload);
    }
    return chats;
}

export function writeCachedChats(cache, chats) {
    if (!cache?.patch || !Array.isArray(chats)) {
        return;
    }

    void cache.patch((payload) => {
        const next = {};
        for (const chat of chats) {
            const item = serializeChat(chat);
            if (item?.id && item.ts && isCurrentChatCacheEntry(item)) {
                next[item.id] = item;
            }
        }
        payload.chatsById = next;
        payload.chatsSavedAt = Date.now();
        return payload;
    });
}

function dropCachedChats(cache, chatIds, currentPayload = null) {
    if (!cache?.patch || !chatIds?.length) {
        return;
    }

    const mediaIds = [];
    const current = currentPayload || cache.read?.();
    for (const chatId of chatIds) {
        const lastMsg = current?.chatsById?.[chatId]?.lastMsg;
        if (lastMsg) {
            mediaIds.push(...collectMediaIds(current, [lastMsg]));
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
