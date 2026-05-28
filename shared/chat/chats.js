'use client';

import { canShowMsg } from './messages.js';
import { collectMessageKeys, messageHasKey } from './messagekeys.js';
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

function samePreviewMsg(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
        a.cid === b.cid &&
        a.id === b.id &&
        a.t === b.t &&
        a.c === b.c &&
        a.sys === b.sys &&
        a.retention === b.retention &&
        timestampMs(a.ttl) === timestampMs(b.ttl) &&
        a.pending === b.pending &&
        a.failed === b.failed
    );
}

function cleanPreviewReplacement(replacement, keys) {
    return replacement && canShowMsg(replacement) && !messageHasKey(replacement, keys) ? replacement : null;
}

function previewUnseen(chatId, lastMsg, chatPK, readCache) {
    if (!lastMsg || !canShowMsg(lastMsg)) {
        return false;
    }
    const from = lastMsg?.from || lastMsg?.s || lastMsg?.head?.from;
    if (!from || from === chatPK) {
        return false;
    }
    const readMs = readCache instanceof Map ? readCache.get(chatId) : null;
    const lastMs = timestampMs(lastMsg.ts);
    return readMs == null || lastMs == null || readMs < lastMs;
}

export function mergeChatPreviewDrop(overridesByChat, chatId, keys, replacement) {
    if (!(overridesByChat instanceof Map) || !chatId) {
        return false;
    }
    const nextKeys = keys instanceof Set ? new Set(keys) : collectMessageKeys(keys);
    if (!nextKeys.size) {
        return false;
    }

    const current = overridesByChat.get(chatId);
    const mergedKeys = new Set(current?.keys || []);
    let keysChanged = false;
    for (const key of nextKeys) {
        if (!mergedKeys.has(key)) {
            mergedKeys.add(key);
            keysChanged = true;
        }
    }

    const lastMsg = cleanPreviewReplacement(replacement, mergedKeys);
    const lastMsgChanged = !samePreviewMsg(current?.lastMsg ?? null, lastMsg);
    if (!keysChanged && !lastMsgChanged) {
        return false;
    }

    overridesByChat.set(chatId, { keys: mergedKeys, lastMsg });
    return true;
}

export function applyChatPreviewOverrides(chats, overridesByChat, chatPK, readCache) {
    if (!(overridesByChat instanceof Map) || !overridesByChat.size) {
        return chats;
    }

    let changed = false;
    const next = (chats || []).map((chat) => {
        const override = overridesByChat.get(chat?.id);
        if (!override?.keys?.size) {
            return chat;
        }

        const lastMsg = cleanPreviewReplacement(override.lastMsg, override.keys);
        if (chat?.lastMsg && !messageHasKey(chat.lastMsg, override.keys)) {
            if (samePreviewMsg(chat.lastMsg, lastMsg)) {
                return chat;
            }
            overridesByChat.delete(chat.id);
            return chat;
        }

        const unseen = previewUnseen(chat.id, lastMsg, chatPK, readCache);
        if (samePreviewMsg(chat?.lastMsg ?? null, lastMsg) && chat?.unseen === unseen) {
            return chat;
        }

        changed = true;
        return {
            ...chat,
            lastMsg,
            unseen,
        };
    });

    return changed ? next : chats;
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
    const nextKeys = keys instanceof Set ? keys : collectMessageKeys(keys);
    if (!nextKeys.size) {
        return chats;
    }

    let changed = false;
    const next = (chats || []).map((chat) => {
        if (chat?.id !== chatId || !chat.lastMsg) {
            return chat;
        }
        if (!messageHasKey(chat.lastMsg, nextKeys)) {
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
    return clearChatPreviewsByKeys(chats, chatId, collectMessageKeys(messages));
}

export function clearChatPreviewsByHiddenKeys(chats, hiddenKeysByChat) {
    if (!(hiddenKeysByChat instanceof Map) || !hiddenKeysByChat.size) {
        return chats;
    }

    let changed = false;
    const next = (chats || []).map((chat) => {
        const keys = hiddenKeysByChat.get(chat?.id);
        if (!chat?.lastMsg || !messageHasKey(chat.lastMsg, keys)) {
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
