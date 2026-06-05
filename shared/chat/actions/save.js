'use client';

import { useCallback } from 'react';
import { dropCachedMedia, readCachedMedia, writeCachedMedia } from '../../cache/localdata.js';
import { attachmentBytes, isFileGoneError, makeChatUnavailableError, makeFileGoneError, saveMedia } from '../attachments.js';
import { getMediaFileRef } from '../filepayload.js';
import { isExpiredAttachmentMsg } from '../messages.js';
import { makeMessagePreviewMedia, MESSAGE_PREVIEW_MIME } from '../previews.js';
import { makeMsgPermanent, makeMsgTemporary, readMsgMedia } from '../messages/write.js';
import { cleanText } from '../../utils/text.js';

function hasInvalidStoredMediaRef(message) {
    const path = cleanText(message?.p);
    const fileKey = cleanText(message?.k);
    if (!path || !fileKey || path.startsWith('local:') || fileKey === 'local') {
        return false;
    }

    try {
        getMediaFileRef(path);
        return false;
    } catch {
        return true;
    }
}

function readMessageMedia(cloud, media, chatPK, chatPrivateKey, peerChatPK, message) {
    const readChatMedia = cloud?.chat?.media?.read;
    if (typeof media?.readMessageFile === 'function') {
        return media.readMessageFile(readChatMedia, chatPK, chatPrivateKey, peerChatPK, message);
    }
    return readMsgMedia(readChatMedia, chatPK, chatPrivateKey, peerChatPK, message);
}

export function useChatSave({ cloud, media = {}, chatBanned, chatPK, chatPrivateKey, localCache }) {
    const makeMessagePermanent = useCallback(
        async (chatId, message) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            const list = Array.isArray(message) ? message : [message];
            return makeMsgPermanent(cloud, chatId, list);
        },
        [cloud, chatBanned]
    );

    const makeMessageTemporary = useCallback(
        async (chatId, message) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            const list = Array.isArray(message) ? message : [message];
            return makeMsgTemporary(cloud, chatId, list);
        },
        [cloud, chatBanned]
    );

    const readMessageFile = useCallback(
        async (peerChatPK, message) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            if (isExpiredAttachmentMsg(message)) {
                void dropCachedMedia(localCache, message).catch(() => {});
                throw makeFileGoneError();
            }
            if (hasInvalidStoredMediaRef(message)) {
                void dropCachedMedia(localCache, message).catch(() => {});
                throw makeFileGoneError();
            }
            if ((String(message?.p || '').startsWith('local:') || message?.k === 'local') && message?.localData != null) {
                const localBytes = await attachmentBytes(message.localData);
                if (localBytes) {
                    return localBytes;
                }
            }
            const cached = await readCachedMedia(localCache, message);
            if (cached?.byteLength) {
                return cached;
            }

            try {
                const bytes = await readMessageMedia(cloud, media, chatPK, chatPrivateKey, peerChatPK, message);
                saveMedia(localCache, message, bytes, message);
                return bytes;
            } catch (error) {
                if (isFileGoneError(error)) {
                    void dropCachedMedia(localCache, message).catch(() => {});
                }
                throw error;
            }
        },
        [cloud, media, chatBanned, chatPK, chatPrivateKey, localCache]
    );

    const readMessagePreview = useCallback(
        async (message) => {
            const previewMessage = makeMessagePreviewMedia(message);
            if (!previewMessage) {
                return null;
            }
            return readCachedMedia(localCache, previewMessage);
        },
        [localCache]
    );

    const writeMessagePreview = useCallback(
        async (message, bytes, meta = {}) => {
            const mimeType = meta?.mimeType || MESSAGE_PREVIEW_MIME;
            const previewMessage = makeMessagePreviewMedia(message, mimeType);
            if (!previewMessage || !bytes?.byteLength) {
                return false;
            }
            return writeCachedMedia(localCache, previewMessage, bytes, {
                ...meta,
                mimeType,
            });
        },
        [localCache]
    );

    return {
        makeMessagePermanent,
        makeMessageTemporary,
        readMessageFile,
        readMessagePreview,
        writeMessagePreview,
    };
}
