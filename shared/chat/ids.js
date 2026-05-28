import { getMessageKey } from './state.js';

export function getPeerChatPKFromChatId(chatId, myChatPK) {
    const parts = String(chatId ?? '').split('_');
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    return a === myChatPK ? b : a;
}

export function getOwnChatPKFromChatId(chatId, peerChatPK) {
    const parts = String(chatId ?? '').split('_');
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    if (a === peerChatPK) return b;
    if (b === peerChatPK) return a;
    return null;
}

export function filterChatMessages(messages, chatPK, peerChatPK) {
    const allowed = new Set([chatPK, peerChatPK].filter(Boolean));
    if (!allowed.size) {
        return messages || [];
    }

    return (messages || []).filter((message) => {
        const sender = typeof message?.s === 'string' && message.s ? message.s : typeof message?.from === 'string' ? message.from : '';
        return !sender || allowed.has(sender);
    });
}

export function getChatPeerPK(chatItem, chatPK) {
    return chatItem?.participants?.find?.((participant) => participant && participant !== chatPK) ?? getPeerChatPKFromChatId(chatItem?.id, chatPK);
}

export function getChatRowLastMsgKey(chatItem) {
    const lastMsg = chatItem?.lastMsg;
    if (!lastMsg || lastMsg.pending || lastMsg.failed || String(lastMsg?.id || '').startsWith('local:')) {
        return null;
    }
    return getMessageKey(lastMsg);
}
