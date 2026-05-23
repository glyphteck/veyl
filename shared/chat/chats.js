'use client';

import { canShowMsg } from './messages.js';
import { getMessageKey } from './state.js';
import { ttlMillis } from './ttl.js';

export function timestampMs(value) {
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (Number.isFinite(value)) {
        return value;
    }
    return null;
}

export function makeTs(ms) {
    return {
        toMillis() {
            return ms;
        },
        toDate() {
            return new Date(ms);
        },
    };
}

function sameChatShape(a, b) {
    if (!a || !b) return a === b;
    return (
        a.id === b.id &&
        a.ts === b.ts &&
        a.unseen === b.unseen &&
        a.settings?.retention === b.settings?.retention &&
        a.lastMsg?.cid === b.lastMsg?.cid &&
        a.lastMsg?.id === b.lastMsg?.id &&
        a.lastMsg?.t === b.lastMsg?.t &&
        a.lastMsg?.c === b.lastMsg?.c &&
        a.lastMsg?.sys === b.lastMsg?.sys &&
        a.lastMsg?.retention === b.lastMsg?.retention &&
        timestampMs(a.lastMsg?.ttl) === timestampMs(b.lastMsg?.ttl) &&
        a.lastMsg?.pending === b.lastMsg?.pending &&
        a.lastMsg?.failed === b.lastMsg?.failed
    );
}

export function sameChats(prev, next) {
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
        if (!sameChatShape(prev[i], next[i])) return false;
    }
    return true;
}

export function sameLastChat(prev, next) {
    if (!prev && !next) return true;
    if (!prev || !next) return false;
    return prev.peerChatPK === next.peerChatPK && sameChatShape({ id: 0, ts: prev.ts || 0, unseen: false, lastMsg: prev.lastMsg }, { id: 0, ts: next.ts || 0, unseen: false, lastMsg: next.lastMsg });
}

export function getLastChat(chats, chatPK) {
    if (!Array.isArray(chats) || !chats.length) {
        return null;
    }

    const latest = chats.reduce((current, chat) => {
        if (!current || (chat.ts && chat.ts > (current.ts || 0))) {
            return chat;
        }
        return current;
    }, null);

    if (!latest?.lastMsg) {
        return null;
    }

    const peerChatPK = latest.participants?.find?.((participant) => participant !== chatPK) ?? null;
    return {
        lastMsg: latest.lastMsg,
        ts: latest.ts || 0,
        peerChatPK,
    };
}

export function getPeersFromChats(chats, chatPK) {
    const peers = new Set();
    for (const chat of chats || []) {
        const participants = Array.isArray(chat?.participants) ? chat.participants : [];
        for (const participant of participants) {
            if (participant && participant !== chatPK) {
                peers.add(participant);
            }
        }
    }
    return [...peers];
}

function sortChats(chats) {
    return [...chats].sort((a, b) => {
        const delta = (b?.ts || 0) - (a?.ts || 0);
        if (delta !== 0) {
            return delta;
        }
        return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
}

export function filterPendingDeleteChats(chats, pendingDeleteIds) {
    if (!(pendingDeleteIds instanceof Set) || pendingDeleteIds.size === 0) {
        return chats;
    }
    return (chats || []).filter((chatItem) => !pendingDeleteIds.has(chatItem?.id));
}

function messageKeySet(messages) {
    const keys = new Set();
    for (const message of messages || []) {
        if (typeof message === 'string') {
            const key = message.trim();
            if (key) keys.add(key);
            continue;
        }
        const key = getMessageKey(message);
        const id = typeof message?.id === 'string' ? message.id.trim() : '';
        const cid = typeof message?.cid === 'string' ? message.cid.trim() : '';
        if (key) keys.add(key);
        if (id) keys.add(id);
        if (cid) keys.add(cid);
    }
    return keys;
}

function messageMatchesKeys(message, keys) {
    if (!message || !keys?.size) {
        return false;
    }
    const key = getMessageKey(message);
    const id = typeof message.id === 'string' ? message.id.trim() : '';
    const cid = typeof message.cid === 'string' ? message.cid.trim() : '';
    return !!((key && keys.has(key)) || (id && keys.has(id)) || (cid && keys.has(cid)));
}

export function collectMessageKeys(messages) {
    return messageKeySet(messages);
}

function skipChatSet(options) {
    const ids = options?.skipChatIds;
    if (ids instanceof Set) {
        return ids;
    }
    if (Array.isArray(ids)) {
        return new Set(ids.filter(Boolean));
    }
    const id = options?.skipChatId;
    return id ? new Set([id]) : null;
}

export function trimExpiredChatPreviews(chats, options = {}) {
    const skip = skipChatSet(options);
    let changed = false;
    const next = (chats || []).map((chat) => {
        if (!chat?.lastMsg || skip?.has(chat.id) || canShowMsg(chat.lastMsg)) {
            return chat;
        }
        changed = true;
        return {
            ...chat,
            lastMsg: null,
            unseen: false,
        };
    });
    return changed ? next : chats;
}

export function clearChatPreviewsByKeys(chats, chatId, keys) {
    if (!chatId) {
        return chats;
    }
    const nextKeys = keys instanceof Set ? keys : messageKeySet(keys);
    if (!nextKeys.size) {
        return chats;
    }

    let changed = false;
    const next = (chats || []).map((chat) => {
        if (chat?.id !== chatId || !chat.lastMsg) {
            return chat;
        }
        if (!messageMatchesKeys(chat.lastMsg, nextKeys)) {
            return chat;
        }
        changed = true;
        return {
            ...chat,
            lastMsg: null,
            unseen: false,
        };
    });

    return changed ? next : chats;
}

export function clearChatPreviewsByMessages(chats, chatId, messages) {
    return clearChatPreviewsByKeys(chats, chatId, messageKeySet(messages));
}

export function clearChatPreviewsByHiddenKeys(chats, hiddenKeysByChat) {
    if (!(hiddenKeysByChat instanceof Map) || !hiddenKeysByChat.size) {
        return chats;
    }

    let changed = false;
    const next = (chats || []).map((chat) => {
        const keys = hiddenKeysByChat.get(chat?.id);
        if (!chat?.lastMsg || !messageMatchesKeys(chat.lastMsg, keys)) {
            return chat;
        }
        changed = true;
        return {
            ...chat,
            lastMsg: null,
            unseen: false,
        };
    });

    return changed ? next : chats;
}

export function nextChatPreviewExpiryMs(chats, now = Date.now(), options = {}) {
    const skip = skipChatSet(options);
    let next = Infinity;
    for (const chat of chats || []) {
        if (!chat?.lastMsg || skip?.has(chat.id) || !canShowMsg(chat.lastMsg)) {
            continue;
        }
        const ms = ttlMillis(chat.lastMsg.ttl);
        if (ms != null && ms > now && ms < next) {
            next = ms;
        }
    }
    return Number.isFinite(next) ? next : null;
}

export function applyReadCache(chats, chatPK, readCache) {
    if (!chatPK || !(readCache instanceof Map) || !readCache.size) {
        return chats;
    }

    return (chats || []).map((chat) => {
        const readMs = readCache.get(chat?.id);
        const lastMs = timestampMs(chat?.lastMsg?.ts);
        const from = chat?.lastMsg?.from || chat?.lastMsg?.s || null;
        if (readMs == null || lastMs == null || readMs < lastMs || !from || from === chatPK) {
            return chat;
        }

        return {
            ...chat,
            unseen: false,
        };
    });
}

export function setLocalChats(chats, localByChat) {
    if (!(localByChat instanceof Map) || localByChat.size === 0) {
        return chats;
    }

    const next = [...chats];
    const indexById = new Map(next.map((chat, index) => [chat.id, index]));

    for (const [chatId, locals] of localByChat.entries()) {
        const lastMsg = locals?.[locals.length - 1];
        if (!lastMsg) {
            continue;
        }

        const ts = typeof lastMsg.ts?.toMillis === 'function' ? lastMsg.ts.toMillis() : 0;
        const currentIndex = indexById.get(chatId);
        const current = currentIndex != null ? next[currentIndex] : null;
        const participants = current?.participants?.length
            ? current.participants
            : String(chatId ?? '')
                  .split('_')
                  .filter(Boolean);
        const chat = {
            id: chatId,
            ...(current || {}),
            participants,
            lastMsg,
            ts,
            unseen: false,
        };

        if (currentIndex == null) {
            indexById.set(chatId, next.length);
            next.push(chat);
            continue;
        }

        if (ts >= (current?.ts || 0)) {
            next[currentIndex] = chat;
        }
    }

    return sortChats(next);
}
