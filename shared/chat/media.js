'use client';

import { MAX_CHAT_FILE_BYTES, putChatFile, readChatFile } from '../files.js';
import { makeAttachment, makeFile, makeImg, makeMp3, makeMp4 } from './messages.js';

export const MAX_MSG_ATTACHMENT_BYTES = MAX_CHAT_FILE_BYTES;

export function pickAttachmentMeta(meta = {}) {
    return {
        ...(meta?.mimeType ? { m: meta.mimeType } : {}),
        ...(Number.isFinite(meta?.size) ? { z: meta.size } : {}),
        ...(Number.isFinite(meta?.width) ? { w: meta.width } : {}),
        ...(Number.isFinite(meta?.height) ? { h: meta.height } : {}),
        ...(Number.isFinite(meta?.duration) ? { d: meta.duration } : {}),
        ...(meta?.name ? { n: meta.name } : {}),
        ...(meta?.caption ? { c: meta.caption } : {}),
    };
}

function buildAttachmentMsg(type, file) {
    switch (type) {
        case 'img':
            return makeImg(file);
        case 'mp3':
            return makeMp3(file);
        case 'mp4':
            return makeMp4(file);
        case 'file':
            return makeFile(file);
        default:
            return makeAttachment(type, file);
    }
}

export async function putAttachment(storage, pair, cid, type, data, meta = {}) {
    const file = await putChatFile(storage, pair, cid, data, meta);
    return buildAttachmentMsg(type, {
        ...file,
        ...pickAttachmentMeta(meta),
    });
}

export async function putImg(storage, pair, cid, data, meta = {}) {
    return putAttachment(storage, pair, cid, 'img', data, meta);
}

export async function putMp3(storage, pair, cid, data, meta = {}) {
    return putAttachment(storage, pair, cid, 'mp3', data, meta);
}

export async function putMp4(storage, pair, cid, data, meta = {}) {
    return putAttachment(storage, pair, cid, 'mp4', data, meta);
}

export async function putFile(storage, pair, cid, data, meta = {}) {
    return putAttachment(storage, pair, cid, 'file', data, meta);
}

export async function putMsgFile(storage, pair, cid, data, meta = {}) {
    return putFile(storage, pair, cid, data, meta);
}

export function readMsgAttachment(storage, pair, msg) {
    return readChatFile(storage, pair, msg);
}

export function readMsgFile(storage, pair, msg) {
    return readMsgAttachment(storage, pair, msg);
}
