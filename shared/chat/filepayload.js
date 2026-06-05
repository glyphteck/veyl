'use client';

import { createFileKey, encodeFileKey, sealFile } from '../crypto/file.js';
import {
    CHAT_MAX_UPLOAD_FILES,
    CHAT_IMAGE_COMPRESS as CONFIG_CHAT_IMAGE_COMPRESS,
    CHAT_IMAGE_MAX_EDGE,
    CHAT_MEDIA_TTL_DAYS as CONFIG_CHAT_MEDIA_TTL_DAYS,
    CHAT_MEDIA_TTL_MS as CONFIG_CHAT_MEDIA_TTL_MS,
} from '../config.js';
import { cleanBytes, randomBytes, toBytes, toHex } from '../crypto/core.js';

export const CHAT_MEDIA_ROOT = 'chat-media';
export const SHARED_MEDIA_ROOT = 'shared';
export const CHAT_SLOT = 'main';
export const CHAT_MEDIA_TTL_DAYS = CONFIG_CHAT_MEDIA_TTL_DAYS;
export const CHAT_MEDIA_TTL_MS = CONFIG_CHAT_MEDIA_TTL_MS;
export const MAX_CHAT_UPLOAD_FILES = CHAT_MAX_UPLOAD_FILES;
export const MAX_CHAT_IMAGE_EDGE = CHAT_IMAGE_MAX_EDGE;
export const CHAT_IMAGE_COMPRESS = CONFIG_CHAT_IMAGE_COMPRESS;
const CHAT_ID_PATTERN = '[0-9a-fA-F]{64}';
const SHARED_MEDIA_ID_PATTERN = '[0-9a-fA-F]{32}';
const MESSAGE_KEY_PATTERN = '[A-Za-z0-9_-]{8,128}';
const CHAT_MEDIA_FILE_PATTERN = new RegExp(`^${CHAT_MEDIA_ROOT}/(${CHAT_ID_PATTERN})/(${MESSAGE_KEY_PATTERN})/${CHAT_SLOT}$`);
const SHARED_MEDIA_FILE_PATTERN = new RegExp(`^${SHARED_MEDIA_ROOT}/(${SHARED_MEDIA_ID_PATTERN})$`);

export function cleanMediaChatId(value) {
    const chatId = String(value || '').trim();
    if (!new RegExp(`^${CHAT_ID_PATTERN}$`).test(chatId)) {
        throw new Error('invalid media chat id');
    }
    return chatId.toLowerCase();
}

export function cleanMediaMessageKey(value) {
    const messageKey = String(value || '').trim();
    if (!new RegExp(`^${MESSAGE_KEY_PATTERN}$`).test(messageKey)) {
        throw new Error('invalid media message key');
    }
    return messageKey;
}

export function cleanSharedMediaId(value) {
    const sharedId = String(value || '').trim();
    if (!new RegExp(`^${SHARED_MEDIA_ID_PATTERN}$`).test(sharedId)) {
        throw new Error('invalid shared media id');
    }
    return sharedId.toLowerCase();
}

export function mediaFilePath(chatId, messageKey, slot = CHAT_SLOT) {
    const nextChatId = cleanMediaChatId(chatId);
    const nextMessageKey = cleanMediaMessageKey(messageKey);
    if (!slot) {
        throw new Error('media file path parts required');
    }
    return `${CHAT_MEDIA_ROOT}/${nextChatId}/${nextMessageKey}/${slot}`;
}

export function sharedMediaFilePath(sharedId) {
    const nextSharedId = cleanSharedMediaId(sharedId);
    return `${SHARED_MEDIA_ROOT}/${nextSharedId}`;
}

export function makeSharedMediaId() {
    return toHex(randomBytes(16));
}

export function getMediaFileRef(path) {
    const value = String(path || '').trim();
    const chatMatch = value.match(CHAT_MEDIA_FILE_PATTERN);
    if (chatMatch?.[1] && chatMatch?.[2]) {
        return {
            type: 'chat',
            chatId: chatMatch[1].toLowerCase(),
            messageKey: chatMatch[2],
            slot: CHAT_SLOT,
        };
    }

    const sharedMatch = value.match(SHARED_MEDIA_FILE_PATTERN);
    if (sharedMatch?.[1]) {
        return {
            type: 'shared',
            sharedId: sharedMatch[1].toLowerCase(),
        };
    }

    throw new Error('invalid media file path');
}

export function getChatMediaFileRef(path) {
    const ref = getMediaFileRef(path);
    if (ref?.type !== 'chat') {
        throw new Error('invalid media file path');
    }
    return ref;
}

export function getSharedMediaFileRef(path) {
    const ref = getMediaFileRef(path);
    if (ref?.type !== 'shared') {
        throw new Error('invalid shared media file path');
    }
    return ref;
}

export function makeTooManyChatFilesError(count) {
    const error = new Error('too many files');
    error.code = 'too-many-files';
    error.maxFiles = MAX_CHAT_UPLOAD_FILES;
    error.count = count;
    return error;
}

export function assertChatUploadByteSize(bytes) {
    if (!Number.isFinite(bytes?.byteLength)) {
        throw new Error('upload bytes required');
    }
    return bytes.byteLength;
}

export function getChatUploadFileList(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (list.length > MAX_CHAT_UPLOAD_FILES) {
        throw makeTooManyChatFilesError(list.length);
    }
    return list;
}

export function fitChatImageSize(width, height, maxEdge = MAX_CHAT_IMAGE_EDGE) {
    const nextWidth = Number(width) || 0;
    const nextHeight = Number(height) || 0;
    if (!nextWidth || !nextHeight) {
        return null;
    }

    const currentMax = Math.max(nextWidth, nextHeight);
    if (currentMax <= maxEdge) {
        return { width: nextWidth, height: nextHeight };
    }

    const scale = maxEdge / currentMax;
    return {
        width: Math.max(1, Math.round(nextWidth * scale)),
        height: Math.max(1, Math.round(nextHeight * scale)),
    };
}

async function toUploadBytes(data) {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        if (typeof data.arrayBuffer === 'function') {
            return new Uint8Array(await data.arrayBuffer());
        }
        if (typeof FileReader !== 'undefined') {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(new Uint8Array(reader.result));
                reader.onerror = () => reject(reader.error || new Error('blob read failed'));
                reader.readAsArrayBuffer(data);
            });
        }
        if (typeof Response !== 'undefined') {
            return new Uint8Array(await new Response(data).arrayBuffer());
        }
    }
    if (typeof data?.arrayBuffer === 'function') {
        return new Uint8Array(await data.arrayBuffer());
    }
    return toBytes(data, 'upload bytes');
}

export async function makeChatFileUploadPayload(pair, cid, data, { slot = CHAT_SLOT, contentType = 'application/octet-stream', cacheControl = 'private, max-age=0, no-transform' } = {}) {
    const chatId = cleanMediaChatId(pair?.chatId);
    const messageKey = cleanMediaMessageKey(cid);
    const path = mediaFilePath(chatId, messageKey, slot);
    const expiresAt = Date.now() + CHAT_MEDIA_TTL_MS;
    const key = createFileKey();
    try {
        const uploadBytes = await toUploadBytes(data);
        assertChatUploadByteSize(uploadBytes);
        return {
            chatId,
            messageKey,
            path,
            body: await sealFile(pair, key, uploadBytes, path),
            metadata: {
                contentType,
                cacheControl,
            },
            file: {
                p: path,
                k: encodeFileKey(key),
                x: expiresAt,
            },
        };
    } catch (error) {
        if (error && typeof error === 'object') {
            error.path = error?.path || path;
            error.cid = error?.cid || cid;
        }
        throw error;
    } finally {
        cleanBytes(key);
    }
}

export async function makeSharedFileUploadPayload(data, { contentType = 'application/octet-stream', cacheControl = 'private, max-age=0, no-transform' } = {}) {
    const sharedId = makeSharedMediaId();
    const path = sharedMediaFilePath(sharedId);
    const expiresAt = Date.now() + CHAT_MEDIA_TTL_MS;
    const key = createFileKey();
    try {
        const uploadBytes = await toUploadBytes(data);
        assertChatUploadByteSize(uploadBytes);
        return {
            sharedId,
            path,
            body: await sealFile(null, key, uploadBytes, path),
            metadata: {
                contentType,
                cacheControl,
            },
            file: {
                p: path,
                k: encodeFileKey(key),
                x: expiresAt,
            },
        };
    } catch (error) {
        if (error && typeof error === 'object') {
            error.path = error?.path || path;
            error.sharedId = error?.sharedId || sharedId;
        }
        throw error;
    } finally {
        cleanBytes(key);
    }
}
