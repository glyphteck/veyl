'use client';

import { useCallback } from 'react';
import { dropCachedMedia, readCachedMedia, writeCachedMedia } from '../../localdatacache.js';
import { randomBytes, toHex } from '../../crypto/core.js';
import { attachmentBytes, isFileGoneError, makeChatUnavailableError, makeFileGoneError, saveMedia } from '../attachments.js';
import { timestampMs } from '../chats.js';
import { CHAT_MEDIA_TTL_MS, getMediaFileId } from '../filepayload.js';
import { getPeerChatPKFromChatId } from '../ids.js';
import { hasStoredFileRef, isAttachmentMsgType, isExpiredAttachmentMsg } from '../messages.js';
import { makeMessagePreviewMedia, MESSAGE_PREVIEW_MIME } from '../previews.js';

export function newMediaStayId() {
    return toHex(randomBytes(16));
}

export function newMediaStayKey() {
    return toHex(randomBytes(16));
}

function mediaStayCapability(message) {
    const id = typeof message?.stay === 'string' ? message.stay.trim() : '';
    const key = typeof message?.stayKey === 'string' ? message.stayKey.trim() : '';
    return id && key ? { id, key } : null;
}

export async function requireMediaSaved(chat, path, stay, saved) {
    const id = typeof stay?.id === 'string' ? stay.id.trim() : '';
    const key = typeof stay?.key === 'string' ? stay.key.trim() : '';
    const updated = await chat.setMediaSaved(path, id, key, saved);
    if (updated !== true) {
        throw new Error('media save state unavailable');
    }
}

function hasInvalidStoredMediaRef(message) {
    const path = typeof message?.p === 'string' ? message.p.trim() : '';
    const fileKey = typeof message?.k === 'string' ? message.k.trim() : '';
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

function mediaStay(message) {
    return mediaStayCapability(message) || { id: newMediaStayId(), key: newMediaStayKey() };
}

function makeSavedMessagePayload(message, stay) {
    const { id, ts, ttl, from, pending, failed, localUri, localData, reactions, type, ...payload } = message || {};
    const savedTtl = timestampMs(ttl);
    return {
        ...payload,
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

function temporaryTtlMs(value, message, now = Date.now()) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) {
        return null;
    }
    const mediaExpiresAt = isAttachmentMsgType(message?.t) && Number.isFinite(message?.x) ? message.x : Infinity;
    const maxTtlMs = Math.min(mediaExpiresAt, now + CHAT_MEDIA_TTL_MS);
    return Math.max(now + 1000, Math.min(ms, maxTtlMs));
}

function unsavedMessageTtlMs(message, ttlMs) {
    const now = Date.now();
    const requestedTtlMs = temporaryTtlMs(ttlMs, message, now);
    if (requestedTtlMs != null) {
        return requestedTtlMs;
    }
    const savedTtlMs = temporaryTtlMs(message?.savedTtl, message, now);
    if (savedTtlMs != null) {
        return savedTtlMs;
    }
    const expiresAt = Number.isFinite(message?.x) ? message.x : now + CHAT_MEDIA_TTL_MS;
    return Math.max(now + 1000, Math.min(expiresAt, now + CHAT_MEDIA_TTL_MS));
}

function hasSavedMessagePayload(message) {
    return message?.permanent === true || Number.isFinite(Number(message?.savedTtl)) || !!mediaStayCapability(message);
}

export function useChatSave({ chat, chatBanned, chatPK, chatPrivateKey, localCache }) {
    const makeMessagePermanent = useCallback(
        async (chatId, message, peerChatPKOption) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            const list = Array.isArray(message) ? message : [message];
            const peerChatPK = peerChatPKOption || getPeerChatPKFromChatId(chatId, chatPK);

            for (const item of list) {
                if (!item?.id || item.pending || item.failed) {
                    continue;
                }
                if (!chatPK || !chatPrivateKey || !peerChatPK) {
                    throw makeChatUnavailableError();
                }
                const saveMediaRef = isAttachmentMsgType(item.t) && hasStoredFileRef(item);
                const stay = saveMediaRef ? mediaStay(item) : null;
                if (saveMediaRef) {
                    await requireMediaSaved(chat, item.p, stay, true);
                }
                const nextMessage = makeSavedMessagePayload(item, stay);
                try {
                    await chat.updateMessage(chatId, item.id, chatPrivateKey, peerChatPK, nextMessage, { updateLastMsg: false });
                } catch (error) {
                    if (saveMediaRef) {
                        await requireMediaSaved(chat, item.p, stay, false).catch(() => {});
                    }
                    throw error;
                }
            }

            return chat.makeMessagePermanent(chatId, list);
        },
        [chat, chatBanned, chatPK, chatPrivateKey]
    );

    const makeMessageTemporary = useCallback(
        async (chatId, message, peerChatPKOption, options = {}) => {
            if (chatBanned) {
                throw makeChatUnavailableError();
            }
            const list = Array.isArray(message) ? message : [message];
            const peerChatPK = peerChatPKOption || getPeerChatPKFromChatId(chatId, chatPK);
            const ttlMs = Number.isFinite(options?.ttlMs) ? options.ttlMs : null;
            let updated = 0;

            for (const item of list) {
                if (!item?.id || item.pending || item.failed) {
                    continue;
                }
                const updateBody = hasSavedMessagePayload(item) || (isAttachmentMsgType(item.t) && hasStoredFileRef(item));
                if (updateBody && (!chatPK || !chatPrivateKey || !peerChatPK)) {
                    throw makeChatUnavailableError();
                }
                if (isAttachmentMsgType(item.t) && hasStoredFileRef(item)) {
                    const stay = mediaStayCapability(item);
                    await chat.updateMessage(chatId, item.id, chatPrivateKey, peerChatPK, makeUnsavedMessagePayload(item), { updateLastMsg: false });
                    updated += await chat.makeMessageTemporary(chatId, [item], unsavedMessageTtlMs(item, ttlMs));
                    if (stay) {
                        await requireMediaSaved(chat, item.p, stay, false);
                    }
                    continue;
                }

                if (updateBody) {
                    await chat.updateMessage(chatId, item.id, chatPrivateKey, peerChatPK, makeUnsavedMessagePayload(item), { updateLastMsg: false });
                }
                updated += await chat.makeMessageTemporary(chatId, [item], unsavedMessageTtlMs(item, ttlMs));
            }

            return updated;
        },
        [chat, chatBanned, chatPK, chatPrivateKey]
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
