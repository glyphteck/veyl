'use client';

import { putChatFile, putSharedFile, readChatFile } from '../files.js';
import { makeAttachment, makeFile, makeImg, makeM4a, makeMp4 } from './messages.js';

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
        case 'm4a':
            return makeM4a(file);
        case 'mp4':
            return makeMp4(file);
        case 'file':
            return makeFile(file);
        default:
            return makeAttachment(type, file);
    }
}

export async function putAttachment(pair, cid, type, data, meta = {}) {
    const file = await putChatFile(pair, cid, data, meta);
    return buildAttachmentMsg(type, {
        ...file,
        ...pickAttachmentMeta(meta),
    });
}

export async function putSharedAttachment(type, data, meta = {}) {
    const file = await putSharedFile(data, meta);
    return buildAttachmentMsg(type, {
        ...file,
        ...pickAttachmentMeta(meta),
    });
}

export async function putImg(pair, cid, data, meta = {}) {
    return putAttachment(pair, cid, 'img', data, meta);
}

export async function putM4a(pair, cid, data, meta = {}) {
    return putAttachment(pair, cid, 'm4a', data, meta);
}

export async function putMp4(pair, cid, data, meta = {}) {
    return putAttachment(pair, cid, 'mp4', data, meta);
}

export async function putFile(pair, cid, data, meta = {}) {
    return putAttachment(pair, cid, 'file', data, meta);
}

export function readMsgAttachment(readChatMedia, pair, msg) {
    return readChatFile(readChatMedia, pair, msg);
}

export function readMsgFile(readChatMedia, pair, msg) {
    return readMsgAttachment(readChatMedia, pair, msg);
}
