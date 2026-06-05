'use client';

import { decodeFileKey, openFileForPath } from './crypto/file.js';
import { randomBytes, toHex } from './crypto/core.js';
import { CHAT_SLOT, getMediaFileRef, makeChatFileUploadPayload, makeSharedFileUploadPayload, mediaFilePath, sharedMediaFilePath } from './chat/filepayload.js';

export { getMediaFileRef, mediaFilePath, sharedMediaFilePath };

export function makeFileId(size = 8) {
    return toHex(randomBytes(size));
}

function setErrorStage(error, stage, extra = {}) {
    if (!error || typeof error !== 'object') {
        return error;
    }
    error.stage = error?.stage || stage;
    Object.assign(error, extra);
    return error;
}

export async function makeChatFileUpload(pair, cid, data, { slot = CHAT_SLOT, contentType = 'application/octet-stream', cacheControl = 'private, max-age=0, no-transform' } = {}) {
    try {
        return await makeChatFileUploadPayload(pair, cid, data, {
            slot,
            contentType,
            cacheControl,
        });
    } catch (error) {
        throw setErrorStage(error, 'encrypt', {
            ...(error?.path ? { path: error.path } : {}),
            cid,
        });
    }
}

export async function putChatFile(pair, cid, data, options) {
    const upload = await makeChatFileUpload(pair, cid, data, options);
    try {
        if (typeof options?.uploadChatMedia !== 'function') {
            throw new Error('chat media upload required');
        }
        await options.uploadChatMedia(upload);
        return upload.file;
    } catch (error) {
        throw setErrorStage(error, 'upload', { path: upload.path, cid });
    }
}

export async function makeSharedFileUpload(data, { contentType = 'application/octet-stream', cacheControl = 'private, max-age=0, no-transform' } = {}) {
    try {
        return await makeSharedFileUploadPayload(data, {
            contentType,
            cacheControl,
        });
    } catch (error) {
        throw setErrorStage(error, 'encrypt', {
            ...(error?.path ? { path: error.path } : {}),
        });
    }
}

export async function putSharedFile(data, options = {}) {
    const upload = await makeSharedFileUpload(data, options);
    try {
        if (typeof options?.uploadSharedMedia !== 'function') {
            throw new Error('shared media upload required');
        }
        await options.uploadSharedMedia(upload);
        return upload.file;
    } catch (error) {
        throw setErrorStage(error, 'upload', { path: upload.path });
    }
}

export async function readChatFile(readChatMedia, _pair, file) {
    let body;
    try {
        if (typeof readChatMedia !== 'function') {
            throw new Error('chat media read required');
        }
        body = await readChatMedia(file?.p);
    } catch (error) {
        error.path = error?.path || file?.p || null;
        error.stage = error?.stage || 'download';
        throw error;
    }

    try {
        getMediaFileRef(file?.p);
        const bytes = await openFileForPath(decodeFileKey(file?.k), body, file?.p);
        return bytes;
    } catch (error) {
        error.path = file?.p || null;
        error.stage = 'decrypt';
        throw error;
    }
}
