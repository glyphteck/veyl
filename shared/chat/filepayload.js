'use client';

import { createFileKey, encodeFileKey, sealFile } from '../crypto/file.js';
import {
    CHAT_FILE_SIZE_LIMIT_ENABLED as CONFIG_CHAT_FILE_SIZE_LIMIT_ENABLED,
    CHAT_MAX_FILE_BYTES,
    CHAT_MAX_UPLOAD_FILES,
    CHAT_IMAGE_COMPRESS as CONFIG_CHAT_IMAGE_COMPRESS,
    CHAT_IMAGE_MAX_EDGE,
    CHAT_MEDIA_ID_BYTES,
    CHAT_MEDIA_TTL_DAYS as CONFIG_CHAT_MEDIA_TTL_DAYS,
    CHAT_MEDIA_TTL_MS as CONFIG_CHAT_MEDIA_TTL_MS,
} from '../config.js';
import { cleanBytes, randomBytes, toBytes, toHex } from '../crypto/core.js';

export const CHAT_MEDIA_ROOT = 'media';
export const CHAT_SLOT = 'main';
export const CHAT_MEDIA_TTL_DAYS = CONFIG_CHAT_MEDIA_TTL_DAYS;
export const CHAT_MEDIA_TTL_MS = CONFIG_CHAT_MEDIA_TTL_MS;
export const MAX_CHAT_FILE_BYTES = CHAT_MAX_FILE_BYTES;
export const CHAT_FILE_SIZE_LIMIT_ENABLED = CONFIG_CHAT_FILE_SIZE_LIMIT_ENABLED;
export const MAX_CHAT_UPLOAD_FILES = CHAT_MAX_UPLOAD_FILES;
export const MAX_CHAT_IMAGE_EDGE = CHAT_IMAGE_MAX_EDGE;
export const CHAT_IMAGE_COMPRESS = CONFIG_CHAT_IMAGE_COMPRESS;
const MEDIA_ID_BYTES = CHAT_MEDIA_ID_BYTES;
const MEDIA_ID_PATTERN = '[0-9a-fA-F]{32}';
const MEDIA_FILE_PATTERN = new RegExp(`^${CHAT_MEDIA_ROOT}/(${MEDIA_ID_PATTERN})/${CHAT_SLOT}$`);

export function makeMediaId() {
    return toHex(randomBytes(MEDIA_ID_BYTES));
}

export function mediaFilePath(mediaId = makeMediaId(), slot = CHAT_SLOT) {
    if (!mediaId || !slot) {
        throw new Error('media file path parts required');
    }
    return `${CHAT_MEDIA_ROOT}/${mediaId}/${slot}`;
}

export function getMediaFileId(path) {
    const match = String(path || '').trim().match(MEDIA_FILE_PATTERN);
    if (!match?.[1]) {
        throw new Error('invalid media file path');
    }
    return match[1];
}

export function makeTooManyChatFilesError(count) {
    const error = new Error('too many files');
    error.code = 'too-many-files';
    error.maxFiles = MAX_CHAT_UPLOAD_FILES;
    error.count = count;
    return error;
}

export function makeChatFileTooLargeError(size) {
    const error = new Error('file too large');
    error.code = 'file-too-large';
    error.maxBytes = MAX_CHAT_FILE_BYTES;
    if (Number.isFinite(size)) {
        error.size = size;
    }
    return error;
}

export function assertChatUploadByteSize(bytes) {
    if (!Number.isFinite(bytes?.byteLength)) {
        throw new Error('upload bytes required');
    }
    if (CHAT_FILE_SIZE_LIMIT_ENABLED && bytes.byteLength > MAX_CHAT_FILE_BYTES) {
        throw makeChatFileTooLargeError(bytes.byteLength);
    }
    return bytes.byteLength;
}

export function assertChatUploadFileSize(file) {
    if (CHAT_FILE_SIZE_LIMIT_ENABLED && Number.isFinite(file?.size) && file.size > MAX_CHAT_FILE_BYTES) {
        throw makeChatFileTooLargeError(file.size);
    }
    return Number.isFinite(file?.size) ? file.size : null;
}

export function getChatUploadFileList(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (list.length > MAX_CHAT_UPLOAD_FILES) {
        throw makeTooManyChatFilesError(list.length);
    }
    for (const file of list) {
        assertChatUploadFileSize(file);
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

export function filenameWithExtension(name, ext = 'bin', fallback = 'file') {
    const raw = String(name || fallback).trim();
    const base = raw.replace(/\.[^.]+$/, '') || fallback;
    return `${base}.${ext}`;
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

export async function makeChatFileUploadPayload(_pair, cid, data, { slot = CHAT_SLOT, contentType = 'application/octet-stream', cacheControl = 'private, max-age=0, no-transform', stay = '', stayKey = '' } = {}) {
    const mediaId = makeMediaId();
    const path = mediaFilePath(mediaId, slot);
    const expiresAt = Date.now() + CHAT_MEDIA_TTL_MS;
    const stayId = typeof stay === 'string' ? stay.trim() : '';
    const mediaStayKey = typeof stayKey === 'string' ? stayKey.trim() : '';
    const key = createFileKey();
    try {
        const uploadBytes = await toUploadBytes(data);
        assertChatUploadByteSize(uploadBytes);
        return {
            path,
            body: await sealFile(_pair, key, uploadBytes, path),
            metadata: {
                contentType,
                cacheControl,
            },
            file: {
                p: path,
                k: encodeFileKey(key),
                x: expiresAt,
                ...(stayId ? { stay: stayId } : {}),
                ...(stayId && mediaStayKey ? { stayKey: mediaStayKey } : {}),
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
