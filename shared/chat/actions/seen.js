'use client';

import { useCallback } from 'react';
import { writeCachedChats } from '../../cache/localdata.js';
import { sendReadReceipt, setChatRead } from '../messages/write.js';
import { markChatsRead, readCandidate, scheduleReadReceiptWrite } from '../read.js';
import { withChatPreviewOpened } from '../messages/preview.js';

export function useChatSeen({ cloud, uid, chatBanned, chatPK, chatPrivateKey, localCache, pendingReadRef, readCacheRef, readReceiptWriteDelay, getChatRetention, setChats }) {
    const scheduleReadReceipt = useCallback(
        (chatId, message, previewMs) => {
            scheduleReadReceiptWrite({
                pendingRead: pendingReadRef.current,
                chatId,
                message,
                previewMs,
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
                const nextChats = markChatsRead(prevChats, chatId, read.preview, { chatPK, readMs: read.previewMs });
                writeCachedChats(localCache, nextChats);
                return nextChats;
            });

            readCacheRef.current.set(chatId, read.previewMs);
            void setChatRead(cloud, uid, chatPrivateKey, chatId, read.previewMs, {
                preview: (currentPreview) => withChatPreviewOpened(currentPreview, read.preview, read.previewMs, chatPK, chatPK) || currentPreview,
            }).catch((error) => {
                console.warn('chat read state write failed', error);
            });
            if (sendReceipt) {
                scheduleReadReceipt(chatId, read.preview, read.previewMs);
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
