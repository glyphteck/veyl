'use client';

import { useCallback } from 'react';
import { dropCachedMedia, readCachedMedia, writeCachedMedia } from '../../cache/localdata.js';
import { randomBytes, toHex } from '../../crypto/core.js';
import { attachmentBytes, isFileGoneError, makeChatUnavailableError, makeFileGoneError, saveMedia } from '../attachments.js';
import { CHAT_MEDIA_TTL_MS, getMediaFileId } from '../filepayload.js';
import { hasStoredFileRef, isAttachmentMsgType, isExpiredAttachmentMsg, mediaStayRef } from '../messages.js';
import { makeMessagePreviewMedia, MESSAGE_PREVIEW_MIME } from '../previews.js';
import { cleanText } from '../../utils/text.js';
import { timestampMs } from '../../utils/time.js';

export function newMediaStayId() {
    return toHex(randomBytes(16));
}

export function newMediaStayKey() {
    return toHex(randomBytes(16));
}

export async function requireMediaSaved(chat, path, stay, saved) {
    const id = cleanText(stay?.id);
    const key = cleanText(stay?.key);
    const updated = await chat.setMediaSaved(path, id, key, saved);
    if (updated !== true) {
        throw new Error('media save state unavailable');
    }
}

function hasInvalidStoredMediaRef(message) {
    const path = cleanText(message?.p);
    const fileKey = cleanText(message?.k);
    if (!path || !fileKey || path.startsWith('local:') || fileKey === 'local') {
        return false;
    }

    try {
        getMediaFileId(path);
        return false;
    } catch {
        return true;
    }
}

function ensureMediaStay(message) {
    return mediaStayRef(message) || { id: newMediaStayId(), key: newMediaStayKey() };
}

function makeSavedMessagePayload(message, stay) {
    const { ttl, pending, failed, localUri, localData, reactions, type, ...payload } = message || {};
    const savedTtl = timestampMs(ttl);
    return {
        ...payload,
        ttl: null,
        permanent: true,
        ...(Number.isFinite(savedTtl) ? { savedTtl } : {}),
        ...(stay?.id && stay?.key
            ? {
                  x: Number.isFinite(payload.x) ? payload.x : Date.now() + CHAT_MEDIA_TTL_MS,
                  stay: stay.id,
                  stayKey: stay.key,
              }
            : {}),
    };
}

function makeUnsavedMessagePayload(message) {
    const { id, ts, ttl, from, pending, failed, localUri, localData, reactions, type, stay, stayKey, savedTtl, savedTtlMs, permanent, ...payload } = message || {};
    if (!isAttachmentMsgType(message?.t)) {
        return payload;
    }
    return {
        ...payload,
        x: Number.isFinite(payload.x) ? payload.x : Date.now() + CHAT_MEDIA_TTL_MS,
    };
}

function hasSavedMessagePayload(message) {
    return message?.permanent === true || Number.isFinite(Number(message?.savedTtl)) || !!mediaStayRef(message);
}

export function useChatSave({ chat, uid, chatBanned, chatPK, chatPrivateKey, localCache }) {
    const makeMessagePermanent = useCallback(
        async (chatId, message, peerChatPKOption) => {
            void peerChatPKOption;
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            const list = Array.isArray(message) ? message : [message];

            for (const item of list) {
                if (!item?.id || item.pending || item.failed) {
                    continue;
                }
                if (!uid || !chatPrivateKey) {
                    throw makeChatUnavailableError();
                }
                const saveMediaRef = isAttachmentMsgType(item.t) && hasStoredFileRef(item);
                const stay = saveMediaRef ? ensureMediaStay(item) : null;
                if (saveMediaRef) {
                    await requireMediaSaved(chat, item.p, stay, true);
                }
                try {
                    await chat.saveMessage(uid, chatPrivateKey, chatId, makeSavedMessagePayload(item, stay));
                } catch (error) {
                    if (saveMediaRef) {
                        await requireMediaSaved(chat, item.p, stay, false).catch(() => {});
                    }
                    throw error;
                }
            }

            return list.length;
        },
        [chat, uid, chatBanned, chatPrivateKey]
    );

    const makeMessageTemporary = useCallback(
        async (chatId, message, peerChatPKOption, options = {}) => {
            void peerChatPKOption;
            void options;
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            const list = Array.isArray(message) ? message : [message];
            let updated = 0;

            for (const item of list) {
                if (!item?.id || item.pending || item.failed) {
                    continue;
                }
                const updateBody = hasSavedMessagePayload(item) || (isAttachmentMsgType(item.t) && hasStoredFileRef(item));
                if (updateBody && (!uid || !chatPrivateKey)) {
                    throw makeChatUnavailableError();
                }
                if (isAttachmentMsgType(item.t) && hasStoredFileRef(item)) {
                    const stay = mediaStayRef(item);
                    await chat.unsaveMessage(uid, chatPrivateKey, chatId, makeUnsavedMessagePayload(item));
                    updated += 1;
                    if (stay) {
                        await requireMediaSaved(chat, item.p, stay, false);
                    }
                    continue;
                }

                if (updateBody) {
                    await chat.unsaveMessage(uid, chatPrivateKey, chatId, makeUnsavedMessagePayload(item));
                }
                updated += 1;
            }

            return updated;
        },
        [chat, uid, chatBanned, chatPrivateKey]
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
                const bytes = await chat.readMessageFile(chatPK, chatPrivateKey, peerChatPK, message);
                saveMedia(localCache, message, bytes, message);
                return bytes;
            } catch (error) {
                if (isFileGoneError(error)) {
                    void dropCachedMedia(localCache, message).catch(() => {});
                }
                throw error;
            }
        },
        [chat, chatBanned, chatPK, chatPrivateKey, localCache]
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
