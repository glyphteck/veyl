'use client';

import { useCallback } from 'react';
import { writeCachedChats } from '../../cache/localdata.js';
import { sendReadReceipt, setChatRead } from '../messages/write.js';
import { markChatsRead, readCandidate, scheduleReadReceiptWrite } from '../read.js';

export function useChatSeen({ cloud, uid, chatBanned, chatPK, chatPrivateKey, localCache, pendingReadRef, readCacheRef, readReceiptWriteDelay, getChatRetention, setChats }) {
    const scheduleReadReceipt = useCallback(
        (chatId, message, lastMsgMs) => {
            scheduleReadReceiptWrite({
                pendingRead: pendingReadRef.current,
                chatId,
                message,
                lastMsgMs,
                delay: readReceiptWriteDelay,
                write: (pending) => sendReadReceipt(cloud, chatPK, chatPrivateKey, pending.peerChatPK, pending.target, { chatId, retention: getChatRetention(chatId), senderUid: uid }),
                onError: () => {
                    readCacheRef.current.delete(chatId);
                },
            });
        },
        [cloud, uid, chatPK, chatPrivateKey, getChatRetention, pendingReadRef, readCacheRef, readReceiptWriteDelay]
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
            void setChatRead(cloud, uid, chatPrivateKey, chatId, read.lastMsgMs).catch((error) => {
                console.warn('chat read state write failed', error);
            });
            if (sendReceipt) {
                scheduleReadReceipt(chatId, read.lastMsg, read.lastMsgMs);
            }
        },
        [cloud, uid, chatPK, chatPrivateKey, localCache, readCacheRef, scheduleReadReceipt, setChats]
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
