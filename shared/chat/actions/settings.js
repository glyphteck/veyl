'use client';

import { useCallback } from 'react';
import { writeCachedChats } from '../../cache/localdata.js';
import { makeChatUnavailableError } from '../attachments.js';
import { filterPendingDeleteChats, sameChats } from '../chats.js';
import { getChatPeerPK } from '../ids.js';
import { cleanChatRetention, normalizeChatSettings } from '../ttl.js';

export function useChatSettings({ chat, uid, chatBanned, chatPK, chatPrivateKey, localCache, lastServerChatsRef, pendingDeleteIdsRef, chatsRef, setChats }) {
    const setChatTtl = useCallback(
        (chatId, retention) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            const serverChat = lastServerChatsRef.current.find((chatItem) => chatItem?.id === chatId);
            const chatItem = serverChat || chatsRef.current.find((item) => item?.id === chatId);
            const peerChatPK = getChatPeerPK(chatItem, chatPK);
            if (!chatPK || !chatPrivateKey || !peerChatPK) {
                throw makeChatUnavailableError();
            }
            const nextRetention = cleanChatRetention(retention);
            return chat.setChatTtl(chatId, chatPK, chatPrivateKey, peerChatPK, nextRetention, { senderUid: uid, ownEntry: serverChat?.entryId ? serverChat : null }).then((savedRetention) => {
                const retentionValue = cleanChatRetention(savedRetention);
                const patchChat = (chatItem) => {
                    const settings = normalizeChatSettings(chatItem?.settings);
                    if (chatItem?.id !== chatId || settings.retention === retentionValue) {
                        return chatItem;
                    }
                    return { ...chatItem, settings: { ...settings, retention: retentionValue } };
                };

                lastServerChatsRef.current = lastServerChatsRef.current.map(patchChat);
                writeCachedChats(localCache, filterPendingDeleteChats(lastServerChatsRef.current, pendingDeleteIdsRef.current));
                setChats((prev) => {
                    const next = prev.map(patchChat);
                    if (sameChats(prev, next)) {
                        return prev;
                    }
                    chatsRef.current = next;
                    return next;
                });
                return retentionValue;
            });
        },
        [chat, uid, chatBanned, chatPK, chatPrivateKey, chatsRef, lastServerChatsRef, localCache, pendingDeleteIdsRef, setChats]
    );

    return {
        setChatTtl,
    };
}
