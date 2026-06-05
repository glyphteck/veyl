'use client';

import { useCallback } from 'react';
import { makeChatUnavailableError } from '../attachments.js';
import { sendReaction as sendReactionMessage } from '../messages/write.js';

export function useChatReact({ cloud, uid, chatBanned, chatPK, chatPrivateKey, sendOptionsForPeer }) {
    const sendReaction = useCallback(
        (peerChatPK, target, emoji) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            return sendReactionMessage(cloud, chatPK, chatPrivateKey, peerChatPK, target, emoji, { ...sendOptionsForPeer(peerChatPK), senderUid: uid });
        },
        [cloud, uid, chatBanned, chatPK, chatPrivateKey, sendOptionsForPeer]
    );

    return {
        sendReaction,
    };
}
