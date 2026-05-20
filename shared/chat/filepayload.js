'use client';

import { createFileKey, encodeFileKey, sealFile } from '../crypto/file.js';
import { cleanBytes, randomBytes, toBytes, toHex } from '../crypto/core.js';

export const CHAT_MEDIA_ROOT = 'media';
export const CHAT_SLOT = 'main';
export const CHAT_MEDIA_TTL_DAYS = 21;
export const CHAT_MEDIA_TTL_MS = CHAT_MEDIA_TTL_DAYS * 24 * 60 * 60 * 1000;
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;
export const CHAT_FILE_SIZE_LIMIT_ENABLED = false;
const MEDIA_ID_BYTES = 16;
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

function assertChatFileSize(bytes) {
    if (!Number.isFinite(bytes?.byteLength)) {
        throw new Error('upload bytes required');
    }
    if (CHAT_FILE_SIZE_LIMIT_ENABLED && bytes.byteLength > MAX_CHAT_FILE_BYTES) {
        const error = new Error('file too large');
        error.code = 'file-too-large';
        error.maxBytes = MAX_CHAT_FILE_BYTES;
        error.size = bytes.byteLength;
        throw error;
    }
}

export async function makeChatFileUploadPayload(_pair, cid, data, { slot = CHAT_SLOT, contentType = 'application/octet-stream', cacheControl = 'private, max-age=0, no-transform', stay = '' } = {}) {
    const mediaId = makeMediaId();
    const path = mediaFilePath(mediaId, slot);
    const expiresAt = Date.now() + CHAT_MEDIA_TTL_MS;
    const stayId = typeof stay === 'string' ? stay.trim() : '';
    const key = createFileKey();
    try {
        const uploadBytes = await toUploadBytes(data);
        assertChatFileSize(uploadBytes);
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
