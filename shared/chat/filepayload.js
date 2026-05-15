'use client';

import { createFileKey, encodeFileKey, sealFile } from '../crypto/file.js';
import { cleanBytes, toBytes } from '../crypto/core.js';

export const CHAT_MEDIA_ROOT = 'chatmedia';
export const CHAT_SLOT = 'main';
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;
export const CHAT_FILE_SIZE_LIMIT_ENABLED = false;
const CHAT_ID_PATTERN = '[0-9a-fA-F]{64}_[0-9a-fA-F]{64}';
const CHAT_FILE_PATTERN = new RegExp(`^${CHAT_MEDIA_ROOT}/(${CHAT_ID_PATTERN})/[^/]+/[^/]+$`);

export function chatFilePath(chatId, cid, slot = CHAT_SLOT) {
    if (!chatId || !cid || !slot) {
        throw new Error('chat file path parts required');
    }
    return `${CHAT_MEDIA_ROOT}/${chatId}/${cid}/${slot}`;
}

export function getChatFileChatId(path) {
    const match = String(path || '').trim().match(CHAT_FILE_PATTERN);
    if (!match?.[1]) {
        throw new Error('invalid chat file path');
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

export async function makeChatFileUploadPayload(pair, cid, data, { slot = CHAT_SLOT, contentType = 'application/octet-stream', cacheControl = 'private, max-age=0, no-transform' } = {}) {
    const path = chatFilePath(pair?.chatId, cid, slot);
    const key = createFileKey();
    try {
        const uploadBytes = await toUploadBytes(data);
        assertChatFileSize(uploadBytes);
        return {
            path,
            body: await sealFile(pair, key, uploadBytes, path),
            metadata: {
                contentType,
                cacheControl,
                customMetadata: {
                    chatId: pair.chatId,
                    cid,
                    slot,
                },
            },
            file: {
                p: path,
                k: encodeFileKey(key),
            },
        };
    } finally {
        cleanBytes(key);
    }
}
