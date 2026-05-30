'use client';

import { CHAT_FILE_SIZE_LIMIT_ENABLED, MAX_CHAT_FILE_BYTES, makeChatFileTooLargeError } from './filepayload.js';
import { makeTxtFileName } from './messages.js';
import { ATTACHMENT_CACHE_FALLBACK_DELAY_MS, ATTACHMENT_CACHE_IDLE_TIMEOUT_MS } from '../config.js';
import { encoder } from '../crypto/core.js';
import { writeCachedMedia } from '../localdatacache.js';

export function makeChatUnavailableError() {
    const error = new Error('chat unavailable');
    error.code = 'permission-denied';
    return error;
}

export function getAttachmentByteSize(attachment) {
    const direct = attachment?.size;
    if (Number.isFinite(direct)) {
        return direct;
    }
    const data = attachment?.data;
    if (Number.isFinite(data?.size)) {
        return data.size;
    }
    if (Number.isFinite(data?.byteLength)) {
        return data.byteLength;
    }
    return null;
}

export function makeAttachmentTooLargeError(size) {
    return makeChatFileTooLargeError(size);
}

export function checkAttachmentSize(attachment) {
    const size = getAttachmentByteSize(attachment);
    if (CHAT_FILE_SIZE_LIMIT_ENABLED && Number.isFinite(size) && size > MAX_CHAT_FILE_BYTES) {
        throw makeAttachmentTooLargeError(size);
    }
    return size;
}

export function makeAttachmentUnavailableError(type = 'file') {
    const error = new Error(type === 'mp4' ? 'video unavailable' : 'file unavailable');
    error.code = type === 'mp4' ? 'video-unavailable' : 'file-unavailable';
    return error;
}

export function makeFileGoneError() {
    const error = new Error('this file is no longer available');
    error.code = 'file-gone';
    return error;
}

export function isFileGoneError(error) {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const code = typeof error.code === 'string' ? error.code : '';
    if (code === 'file-gone' || code === 'storage/object-not-found' || code.endsWith('/object-not-found')) {
        return true;
    }
    if (error.status === 404) {
        return true;
    }
    const message = String(error.message || '').toLowerCase();
    return message.includes('object') && message.includes('not found');
}

export function makeTxtFileAttachment(message) {
    const text = String(message?.c ?? '');
    return {
        type: 'file',
        data: text,
        mimeType: 'text/plain;charset=utf-8',
        size: encoder.encode(text).byteLength,
        name: makeTxtFileName(text),
    };
}

export async function attachmentBytes(data) {
    if (data == null) {
        return null;
    }
    if (data instanceof Uint8Array) {
        return data;
    }
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return new Uint8Array(await data.arrayBuffer());
    }
    if (typeof data?.arrayBuffer === 'function') {
        return new Uint8Array(await data.arrayBuffer());
    }
    if (typeof data === 'string') {
        return encoder.encode(data);
    }
    return null;
}

export function saveMedia(cache, message, data, meta = {}) {
    if (!cache || !message?.p || !message?.k) {
        return;
    }

    const run = () => {
        void Promise.resolve()
            .then(() => attachmentBytes(data))
            .then((bytes) => {
                if (bytes?.byteLength) {
                    return writeCachedMedia(cache, message, bytes, meta);
                }
                return false;
            })
            .catch(() => {});
    };

    if (typeof globalThis.requestIdleCallback === 'function') {
        globalThis.requestIdleCallback(run, { timeout: ATTACHMENT_CACHE_IDLE_TIMEOUT_MS });
        return;
    }
    setTimeout(run, ATTACHMENT_CACHE_FALLBACK_DELAY_MS);
}

export function getAttachmentType(attachment = {}) {
    const type = typeof attachment?.type === 'string' ? attachment.type.trim() : '';
    if (type) {
        return type;
    }

    const mimeType = typeof attachment?.mimeType === 'string' ? attachment.mimeType.toLowerCase() : '';
    if (mimeType.startsWith('image/')) {
        return 'img';
    }
    if (mimeType.startsWith('audio/')) {
        return 'mp3';
    }
    if (mimeType.startsWith('video/')) {
        return 'mp4';
    }

    return 'file';
}

export function isAttachmentType(type) {
    return type === 'img' || type === 'mp3' || type === 'mp4' || type === 'file';
}
