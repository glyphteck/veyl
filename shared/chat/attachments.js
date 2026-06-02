'use client';

import { MAX_CHAT_UPLOAD_FILES } from './filepayload.js';
import { makeTxtFileName } from './messages.js';
import { ATTACHMENT_CACHE_FALLBACK_DELAY_MS, ATTACHMENT_CACHE_IDLE_TIMEOUT_MS } from '../config.js';
import { encoder } from '../crypto/core.js';
import { writeCachedMedia } from '../cache/localdata.js';
import { cleanText, lowerText } from '../utils/text.js';

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

export function checkAttachmentSize(attachment) {
    return getAttachmentByteSize(attachment);
}

export function makeAttachmentUnavailableError(type = 'file') {
    const error = new Error(type === 'mp4' ? 'video unavailable' : 'file unavailable');
    error.code = type === 'mp4' ? 'video-unavailable' : 'file-unavailable';
    return error;
}

export function formatMaxChatUploadFiles(maxFiles = MAX_CHAT_UPLOAD_FILES) {
    return `${maxFiles} ${maxFiles === 1 ? 'file' : 'files'}`;
}

export function chatUploadErrorMessage(error, options = {}) {
    const fallback = typeof options === 'string' ? options : (options.fallback ?? 'failed to send attachment');
    const code = cleanText(error?.code);

    if (code === 'too-many-files') {
        const label = formatMaxChatUploadFiles(error?.maxFiles || MAX_CHAT_UPLOAD_FILES);
        return typeof options.tooManyFiles === 'function' ? options.tooManyFiles(label, error) : `choose up to ${label}`;
    }

    if (code === 'video-unavailable' && typeof options.videoUnavailable === 'function') {
        return options.videoUnavailable(error);
    }

    return error?.message || fallback;
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
    const message = lowerText(error.message);
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
    const type = cleanText(attachment?.type);
    if (type) {
        return type;
    }

    const mimeType = lowerText(attachment?.mimeType);
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
