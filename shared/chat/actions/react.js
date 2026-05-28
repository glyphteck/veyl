'use client';

import { useCallback } from 'react';
import { makeChatUnavailableError } from '../attachments.js';

export function useChatReact({ chat, chatBanned, chatPK, chatPrivateKey, sendOptionsForPeer }) {
    const sendReaction = useCallback(
        (peerChatPK, target, emoji) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            return chat.sendReaction(chatPK, chatPrivateKey, peerChatPK, target, emoji, sendOptionsForPeer(peerChatPK));
        },
        [chat, chatBanned, chatPK, chatPrivateKey, sendOptionsForPeer]
    );

    return {
        sendReaction,
    };
}
