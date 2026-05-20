'use client';

import { deleteObject, getBytes, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { decodeFileKey, openFileForPath } from './crypto/file.js';
import { randomBytes, toBytes, toHex } from './crypto/core.js';
import { CHAT_SLOT, MAX_CHAT_FILE_BYTES, getMediaFileId, makeChatFileUploadPayload, mediaFilePath } from './chat/filepayload.js';

export { MAX_CHAT_FILE_BYTES, getMediaFileId, mediaFilePath };

export function avatarPath(uid) {
    if (!uid) {
        throw new Error('uid required');
    }
    return `${uid}/avatar.webp`;
}

export function makeFileId(size = 8) {
    return toHex(randomBytes(size));
}

export function reportEvidencePath(reporter, targetUid, evidenceId) {
    if (!reporter || !targetUid || !evidenceId) {
        throw new Error('report evidence path parts required');
    }
    return `reports/${reporter}/${targetUid}/${evidenceId}`;
}

function isReactNative() {
    return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
}

function setErrorStage(error, stage, extra = {}) {
    if (!error || typeof error !== 'object') {
        return error;
    }
    error.stage = error?.stage || stage;
    Object.assign(error, extra);
    return error;
}

async function put(storage, path, data, metadata) {
    if (!storage) {
        throw new Error('storage required');
    }
    const payload = typeof Blob !== 'undefined' && data instanceof Blob ? data : toBytes(data, 'upload bytes');
    return uploadBytes(ref(storage, path), payload, metadata);
}

export async function getFileUrl(storage, path) {
    if (!storage) {
        throw new Error('storage required');
    }
    return getDownloadURL(ref(storage, path));
}

export async function readFile(storage, path) {
    try {
        const bytes = new Uint8Array(await getBytes(ref(storage, path)));
        return bytes;
    } catch (error) {
        if (!isReactNative()) {
            error.path = path;
            error.stage = 'getBytes';
            throw error;
        }
    }

    try {
        const url = await getFileUrl(storage, path);
        const res = await fetch(url);
        if (!res.ok) {
            const error = new Error(`download failed (${res.status})`);
            error.status = res.status;
            throw error;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return bytes;
    } catch (error) {
        error.path = path;
        error.stage = error?.stage || 'fetch';
        throw error;
    }
}

export async function removeFile(storage, path) {
    if (!storage) {
        throw new Error('storage required');
    }
    await deleteObject(ref(storage, path));
}

export async function putAvatar(storage, uid, data, mimeType = 'image/webp') {
    const path = avatarPath(uid);
    const result = await put(storage, path, data, { contentType: mimeType });
    const url = await getFileUrl(storage, path);
    return {
        url,
        generation: result?.metadata?.generation ?? null,
    };
}

export async function dropAvatar(storage, uid) {
    return removeFile(storage, avatarPath(uid));
}

export async function makeChatFileUpload(pair, cid, data, { slot = CHAT_SLOT, contentType = 'application/octet-stream', cacheControl = 'private, max-age=0, no-transform', stay = '' } = {}) {
    try {
        return await makeChatFileUploadPayload(pair, cid, data, {
            slot,
            contentType,
            cacheControl,
            stay,
        });
    } catch (error) {
        throw setErrorStage(error, 'encrypt', {
            ...(error?.path ? { path: error.path } : {}),
            cid,
        });
    }
}

export async function putChatFile(storage, pair, cid, data, options) {
    const upload = await makeChatFileUpload(pair, cid, data, options);
    try {
        await put(storage, upload.path, upload.body, upload.metadata);
        return upload.file;
    } catch (error) {
        throw setErrorStage(error, 'upload', { path: upload.path, cid });
    }
}

export async function readChatFile(storage, _pair, file) {
    let body;
    try {
        body = await readFile(storage, file?.p);
    } catch (error) {
        error.path = error?.path || file?.p || null;
        error.stage = error?.stage || 'download';
        throw error;
    }

    try {
        getMediaFileId(file?.p);
        const bytes = await openFileForPath(decodeFileKey(file?.k), body, file?.p);
        return bytes;
    } catch (error) {
        error.path = file?.p || null;
        error.stage = 'decrypt';
        throw error;
    }
}

export async function putReportEvidence(
    storage,
    reporter,
    targetUid,
    evidenceId,
    data,
    { contentType = 'application/octet-stream', cacheControl = 'private, max-age=0, no-transform', name = '', kind = '' } = {}
) {
    const path = reportEvidencePath(reporter, targetUid, evidenceId);
    const metadata = {
        contentType,
        cacheControl,
        customMetadata: {
            ...(name ? { name } : {}),
            ...(kind ? { kind } : {}),
        },
    };
    await put(storage, path, data, metadata);
    return path;
}
