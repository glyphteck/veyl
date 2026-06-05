import { getMessageKey } from './state.js';

export function getPeerChatPKFromChatId(chatId, myChatPK) {
    return null;
}

export function getOwnChatPKFromChatId(chatId, peerChatPK) {
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
    return chatItem?.peerChatPK || null;
}

export function getChatPreviewKey(chatItem) {
    const preview = chatItem?.preview;
    if (!preview || preview.pending || preview.failed || String(preview?.id || '').startsWith('local:')) {
        return null;
    }
    return getMessageKey(preview);
}
