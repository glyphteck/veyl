'use client';

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
        a.lastMsgTime === b.lastMsgTime &&
        a.unseen === b.unseen &&
        a.lastMsg?.cid === b.lastMsg?.cid &&
        a.lastMsg?.t === b.lastMsg?.t &&
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
    return prev.peerChatPK === next.peerChatPK && sameChatShape({ id: 0, lastMsgTime: 0, unseen: false, lastMsg: prev.lastMsg }, { id: 0, lastMsgTime: 0, unseen: false, lastMsg: next.lastMsg });
}

export function getLastChat(chats, chatPK) {
    if (!Array.isArray(chats) || !chats.length) {
        return null;
    }

    const latest = chats.reduce((current, chat) => {
        if (!current || (chat.lastMsgTime && chat.lastMsgTime > (current.lastMsgTime || 0))) {
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
        const delta = (b?.lastMsgTime || 0) - (a?.lastMsgTime || 0);
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

        const lastMsgTime = typeof lastMsg.ts?.toMillis === 'function' ? lastMsg.ts.toMillis() : 0;
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
            lastMsgTime,
            unseen: false,
        };

        if (currentIndex == null) {
            indexById.set(chatId, next.length);
            next.push(chat);
            continue;
        }

        if (lastMsgTime >= (current?.lastMsgTime || 0)) {
            next[currentIndex] = chat;
        }
    }

    return sortChats(next);
}
