'use client';

import { canShowMsg } from './messages.js';
import { collectMessageKeys, messageHasKey } from './messagekeys.js';
import { ttlMillis } from './ttl.js';
import { timestampMs } from '../utils/time.js';
import { uniqueValues } from '../utils/array.js';
import { cleanText } from '../utils/text.js';
import { getChatPeerPK } from './ids.js';

const HEX_32_RE = /^[0-9a-f]{32}$/i;
const HEX_64_RE = /^[0-9a-f]{64}$/i;

function sameChatShape(a, b) {
    if (!a || !b) return a === b;
    return (
        a.id === b.id &&
        a.linkId === b.linkId &&
        a.ts === b.ts &&
        a.unseen === b.unseen &&
        a.settings?.retention === b.settings?.retention &&
        a.preview?.cid === b.preview?.cid &&
        a.preview?.id === b.preview?.id &&
        a.preview?.s === b.preview?.s &&
        a.preview?.from === b.preview?.from &&
        a.preview?.t === b.preview?.t &&
        a.preview?.c === b.preview?.c &&
        a.preview?.a === b.preview?.a &&
        a.preview?.tx === b.preview?.tx &&
        a.preview?.paidBy === b.preview?.paidBy &&
        a.preview?.sys === b.preview?.sys &&
        a.preview?.retention === b.preview?.retention &&
        timestampMs(a.preview?.ttl) === timestampMs(b.preview?.ttl) &&
        timestampMs(a.preview?.editedAt) === timestampMs(b.preview?.editedAt) &&
        timestampMs(a.preview?.paidAt) === timestampMs(b.preview?.paidAt) &&
        a.preview?.pending === b.preview?.pending &&
        a.preview?.failed === b.preview?.failed
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
    return prev.peerChatPK === next.peerChatPK && sameChatShape({ id: 0, ts: prev.ts || 0, unseen: false, preview: prev.preview }, { id: 0, ts: next.ts || 0, unseen: false, preview: next.preview });
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

    if (!latest?.preview) {
        return null;
    }

    const peerChatPK = getChatPeerPK(latest, chatPK);
    return {
        preview: latest.preview,
        ts: latest.ts || 0,
        peerChatPK,
    };
}

export function getPeersFromChats(chats, chatPK) {
    return uniqueValues((chats || []).map((chat) => getChatPeerPK(chat, chatPK)));
}

export function isChatUnseenForUser(chatData, userChatPK) {
    const last = chatData?.preview;
    if (!last?.ts || !canShowMsg(last)) return false;
    const from = last?.from || last?.s;
    if (from && from === userChatPK) return false;
    const readMs = timestampMs(chatData?.readMs, null);
    const lastMs = timestampMs(last.ts, null);
    if (readMs != null && lastMs != null && readMs >= lastMs) return false;
    return !!from;
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

function chatVersionKey(chat) {
    const peerChatPK = cleanText(chat?.peerChatPK);
    if (peerChatPK) {
        return `peer:${peerChatPK}`;
    }
    const linkId = cleanText(chat?.linkId);
    if (linkId) {
        return `link:${linkId}`;
    }
    const id = cleanText(chat?.id);
    return id ? `chat:${id}` : '';
}

function isHex32(value) {
    return HEX_32_RE.test(cleanText(value));
}

function isHex64(value) {
    return HEX_64_RE.test(cleanText(value));
}

function hasPositiveTimestamp(value) {
    return timestampMs(value, null, { positive: true }) != null;
}

export function isCurrentChatCacheEntry(chat) {
    return !!chat
        && isHex64(chat.id)
        && isHex64(chat.linkId)
        && isHex32(chat.entryId)
        && isHex64(chat.peerChatPK)
        && hasPositiveTimestamp(chat.ts);
}

export function isCurrentUserChatEntry(chat) {
    return isCurrentChatCacheEntry(chat);
}

function hasPendingPreview(chat) {
    return chat?.preview?.pending === true && chat?.preview?.failed !== true;
}

function hasLocalPreviewTimestamp(chat) {
    return chat?.preview?.pending === true || chat?.preview?.failed === true;
}

function hasUsableEntry(chat) {
    return !!cleanText(chat?.entryId);
}

function hasLink(chat) {
    return !!cleanText(chat?.linkId);
}

function preferredChatVersion(current, candidate) {
    if (!current) {
        return candidate;
    }
    if (hasPendingPreview(candidate) !== hasPendingPreview(current)) {
        return hasPendingPreview(candidate) ? candidate : current;
    }

    const currentTs = timestampMs(current?.ts, 0) ?? 0;
    const candidateTs = timestampMs(candidate?.ts, 0) ?? 0;
    if (candidateTs !== currentTs) {
        return candidateTs > currentTs ? candidate : current;
    }

    if (hasUsableEntry(candidate) !== hasUsableEntry(current)) {
        return hasUsableEntry(candidate) ? candidate : current;
    }
    if (hasLink(candidate) !== hasLink(current)) {
        return hasLink(candidate) ? candidate : current;
    }

    return current;
}

export function canonicalChatVersions(chats) {
    if (!Array.isArray(chats) || chats.length < 2) {
        return chats || [];
    }

    const byVersion = new Map();
    const unkeyed = [];

    for (const chat of chats) {
        const key = chatVersionKey(chat);
        if (!key) {
            unkeyed.push(chat);
            continue;
        }
        byVersion.set(key, preferredChatVersion(byVersion.get(key), chat));
    }

    return sortChats([...byVersion.values(), ...unkeyed]);
}

export function preserveChatTimestamps(chats, currentChats) {
    if (!Array.isArray(chats) || !chats.length || !Array.isArray(currentChats) || !currentChats.length) {
        return chats;
    }

    const currentById = new Map();
    for (const chat of currentChats) {
        if (!chat?.id) {
            continue;
        }
        const current = currentById.get(chat.id);
        const chatTs = timestampMs(chat.ts, null);
        const currentTs = timestampMs(current?.ts, null);
        if (chatTs != null && (currentTs == null || chatTs > currentTs)) {
            currentById.set(chat.id, chat);
        }
    }

    let changed = false;
    const next = (chats || []).map((chat) => {
        const current = currentById.get(chat?.id);
        const currentTs = timestampMs(current?.ts, null);
        const nextTs = timestampMs(chat?.ts, null);
        if (currentTs == null || nextTs == null || nextTs >= currentTs || hasLocalPreviewTimestamp(current)) {
            return chat;
        }
        changed = true;
        return {
            ...chat,
            ts: currentTs,
        };
    });

    return changed ? sortChats(next) : chats;
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
        a.s === b.s &&
        a.from === b.from &&
        a.t === b.t &&
        a.c === b.c &&
        a.a === b.a &&
        a.tx === b.tx &&
        a.paidBy === b.paidBy &&
        a.sys === b.sys &&
        a.retention === b.retention &&
        timestampMs(a.ttl) === timestampMs(b.ttl) &&
        timestampMs(a.editedAt) === timestampMs(b.editedAt) &&
        timestampMs(a.paidAt) === timestampMs(b.paidAt) &&
        a.pending === b.pending &&
        a.failed === b.failed
    );
}

function cleanPreviewReplacement(replacement, keys) {
    return replacement && canShowMsg(replacement) && !messageHasKey(replacement, keys) ? replacement : null;
}

function shouldClearPreviewForDrop(chat, override) {
    if (!chat?.preview) {
        return false;
    }
    const cutoffMs = timestampMs(override?.dropCutoffMs, null);
    if (cutoffMs == null) {
        return false;
    }
    const previewMs = timestampMs(chat.preview.ts, null);
    return previewMs == null || previewMs <= cutoffMs;
}

function previewUnseen(chatId, preview, chatPK, readCache) {
    if (!preview || !canShowMsg(preview)) {
        return false;
    }
    const from = preview?.from || preview?.s || preview?.head?.from;
    if (!from || from === chatPK) {
        return false;
    }
    const readMs = readCache instanceof Map ? readCache.get(chatId) : null;
    const lastMs = timestampMs(preview.ts);
    return readMs == null || lastMs == null || readMs < lastMs;
}

export function mergeChatPreviewDrop(overridesByChat, chatId, keys, replacement, options = {}) {
    if (!(overridesByChat instanceof Map) || !chatId) {
        return false;
    }
    const nextKeys = keys instanceof Set ? new Set(keys) : collectMessageKeys(keys);
    if (!nextKeys.size) {
        return false;
    }

    const current = overridesByChat.get(chatId);
    const mergedKeys = new Set(current?.keys || []);
    const currentCutoffMs = timestampMs(current?.dropCutoffMs, null);
    const dropCutoffMs = timestampMs(options?.dropCutoffMs, null) ?? currentCutoffMs;
    let keysChanged = false;
    for (const key of nextKeys) {
        if (!mergedKeys.has(key)) {
            mergedKeys.add(key);
            keysChanged = true;
        }
    }

    const preview = cleanPreviewReplacement(replacement, mergedKeys);
    const previewChanged = !samePreviewMsg(current?.preview ?? null, preview);
    const cutoffChanged = dropCutoffMs !== currentCutoffMs;
    if (!keysChanged && !previewChanged && !cutoffChanged) {
        return false;
    }

    overridesByChat.set(chatId, {
        keys: mergedKeys,
        preview,
        ...(dropCutoffMs != null ? { dropCutoffMs } : {}),
    });
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

        const preview = cleanPreviewReplacement(override.preview, override.keys);
        if (chat?.preview && !messageHasKey(chat.preview, override.keys)) {
            if (shouldClearPreviewForDrop(chat, override)) {
                const unseen = previewUnseen(chat.id, preview, chatPK, readCache);
                if (samePreviewMsg(chat.preview, preview) && chat.unseen === unseen) {
                    return chat;
                }
                changed = true;
                return {
                    ...chat,
                    preview,
                    unseen,
                };
            }
            if (samePreviewMsg(chat.preview, preview)) {
                return chat;
            }
            overridesByChat.delete(chat.id);
            return chat;
        }

        const unseen = previewUnseen(chat.id, preview, chatPK, readCache);
        if (samePreviewMsg(chat?.preview ?? null, preview) && chat?.unseen === unseen) {
            return chat;
        }

        changed = true;
        return {
            ...chat,
            preview,
            unseen,
        };
    });

    return changed ? sortChats(next) : chats;
}

export function replaceChatPreview(chats, chatId, replacement, chatPK, readCache) {
    if (!chatId) {
        return chats;
    }
    const preview = replacement && canShowMsg(replacement) ? replacement : null;
    let changed = false;
    const next = (chats || []).map((chat) => {
        if (chat?.id !== chatId) {
            return chat;
        }
        const unseen = previewUnseen(chat.id, preview, chatPK, readCache);
        if (samePreviewMsg(chat?.preview ?? null, preview) && chat?.unseen === unseen) {
            return chat;
        }
        changed = true;
        return {
            ...chat,
            preview,
            unseen,
        };
    });

    return changed ? sortChats(next) : chats;
}

export function trimExpiredChatPreviews(chats, options = {}) {
    const skip = skipChatSet(options);
    let changed = false;
    const next = (chats || []).map((chat) => {
        if (!chat?.preview || skip?.has(chat.id) || canShowMsg(chat.preview)) {
            return chat;
        }
        changed = true;
        return {
            ...chat,
            preview: null,
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
        if (chat?.id !== chatId || !chat.preview) {
            return chat;
        }
        if (!messageHasKey(chat.preview, nextKeys)) {
            return chat;
        }
        changed = true;
        return {
            ...chat,
            preview: null,
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
        if (!chat?.preview || !messageHasKey(chat.preview, keys)) {
            return chat;
        }
        changed = true;
        return {
            ...chat,
            preview: null,
            unseen: false,
        };
    });

    return changed ? next : chats;
}

export function nextChatPreviewExpiryMs(chats, now = Date.now(), options = {}) {
    const skip = skipChatSet(options);
    let next = Infinity;
    for (const chat of chats || []) {
        if (!chat?.preview || skip?.has(chat.id) || !canShowMsg(chat.preview)) {
            continue;
        }
        const ms = ttlMillis(chat.preview.ttl);
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
        const lastMs = timestampMs(chat?.preview?.ts);
        const from = chat?.preview?.from || chat?.preview?.s || null;
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
        const preview = locals?.[locals.length - 1];
        if (!preview) {
            continue;
        }

        const ts = timestampMs(preview.ts, 0);
        const currentIndex = indexById.get(chatId);
        const current = currentIndex != null ? next[currentIndex] : null;
        const chat = {
            id: chatId,
            ...(current || {}),
            linkId: current?.linkId || preview?.linkId || null,
            peerChatPK: current?.peerChatPK || preview?.peerChatPK || null,
            preview,
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
