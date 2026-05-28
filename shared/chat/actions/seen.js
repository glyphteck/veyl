'use client';

import { useCallback } from 'react';
import { writeCachedChats } from '../../localdatacache.js';
import { markChatsRead, readCandidate, scheduleReadReceiptWrite } from '../read.js';

export function useChatSeen({ chat, chatBanned, chatPK, chatPrivateKey, localCache, pendingReadRef, readCacheRef, readReceiptWriteDelay, getChatRetention, setChats }) {
    const scheduleReadReceipt = useCallback(
        (chatId, message, lastMsgMs) => {
            scheduleReadReceiptWrite({
                pendingRead: pendingReadRef.current,
                chatId,
                message,
                lastMsgMs,
                delay: readReceiptWriteDelay,
                write: (pending) => chat.sendReadReceipt(chatPK, chatPrivateKey, pending.peerChatPK, pending.target, { retention: getChatRetention(chatId) }),
                onError: () => {
                    readCacheRef.current.delete(chatId);
                },
            });
        },
        [chat, chatPK, chatPrivateKey, getChatRetention, pendingReadRef, readCacheRef, readReceiptWriteDelay]
    );

    const checkLastRead = useCallback(
        async (chatId, message, { sendReceipt = true } = {}) => {
            if (!chatId || !chatPK || !chatPrivateKey || !message?.id || String(message.id).startsWith('local:')) {
                return;
            }

            const read = readCandidate({
                chatId,
                chatPK,
                chatPrivateKey,
                message,
                readCache: readCacheRef.current,
            });
            if (!read) {
                return;
            }

            setChats((prevChats) => {
                const nextChats = markChatsRead(prevChats, chatId, read.lastMsg);
                writeCachedChats(localCache, nextChats);
                return nextChats;
            });

            readCacheRef.current.set(chatId, read.lastMsgMs);
            if (sendReceipt) {
                scheduleReadReceipt(chatId, read.lastMsg, read.lastMsgMs);
            }
        },
        [chatPK, chatPrivateKey, localCache, readCacheRef, scheduleReadReceipt, setChats]
    );

    const markChatReadReceipt = useCallback(
        (chatId, message) => {
            if (chatBanned || !chatId || !message) {
                return;
            }
            void checkLastRead(chatId, message);
        },
        [chatBanned, checkLastRead]
    );

    const markChatRead = useCallback(
        (chatId, message) => {
            if (!chatId || !message) {
                return;
            }
            void checkLastRead(chatId, message, { sendReceipt: false });
        },
        [checkLastRead]
    );

    return {
        markChatReadReceipt,
        markChatRead,
    };
}
