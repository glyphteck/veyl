import { CHAT_MEDIA_TTL_MS, getMediaFileId } from '../filepayload.js';
import { ATTACHMENT_MSG_TYPES, UNAVAILABLE_REPLY_MSG_TYPE, UNAVAILABLE_REPLY_TEXT } from './types.js';
import { hasText } from './text.js';

export function hasLocalFileRef(msg) {
    if (!hasText(msg?.p) || !hasText(msg?.k)) {
        return false;
    }
    return String(msg.p).startsWith('local:') || msg.k === 'local';
}

export function hasStoredFileRef(msg) {
    if (!hasText(msg?.p) || !hasText(msg?.k)) {
        return false;
    }
    if (hasLocalFileRef(msg)) {
        return false;
    }

    try {
        getMediaFileId(msg.p);
        return true;
    } catch {
        return false;
    }
}

function hasFileRef(msg) {
    return hasLocalFileRef(msg) || hasStoredFileRef(msg);
}

export function formatAttachmentSize(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

export function getAttachmentTitle(msg) {
    if (hasText(msg?.n)) {
        return msg.n.trim();
    }
    if (hasText(msg?.c)) {
        return msg.c.trim();
    }

    switch (msg?.t) {
        case 'mp3':
            return 'audio';
        case 'mp4':
            return 'video';
        case 'img':
            return 'image';
        default:
            return 'file';
    }
}

export function getAttachmentCaption(msg) {
    const caption = hasText(msg?.c) ? msg.c.trim() : '';
    return caption && caption !== getAttachmentTitle(msg) ? caption : '';
}

export function isExpiredAttachmentMsg(msg, now = Date.now()) {
    return isAttachmentMsgType(msg?.t) && !hasText(msg?.stay) && Number.isFinite(msg?.x) && msg.x <= now;
}

export function getImageAspect(msg, fallback = 4 / 3) {
    const width = Number(msg?.w);
    const height = Number(msg?.h);
    if (width > 0 && height > 0) {
        return width / height;
    }
    return fallback;
}

export function isAttachmentMsgType(type) {
    return ATTACHMENT_MSG_TYPES.includes(type);
}

export function makeAttachment(t, file) {
    if (!isAttachmentMsgType(t)) {
        throw new Error('attachment type required');
    }

    const p = typeof file?.p === 'string' ? file.p.trim() : '';
    const k = typeof file?.k === 'string' ? file.k.trim() : '';
    if (!p || !k) {
        throw new Error('file path and key required');
    }

    return {
        t,
        p,
        k,
        ...(file?.m ? { m: String(file.m) } : {}),
        ...(Number.isFinite(file?.z) ? { z: Math.max(0, Math.trunc(file.z)) } : {}),
        ...(Number.isFinite(file?.w) ? { w: Math.max(0, Math.trunc(file.w)) } : {}),
        ...(Number.isFinite(file?.h) ? { h: Math.max(0, Math.trunc(file.h)) } : {}),
        ...(Number.isFinite(file?.d) ? { d: Math.max(0, Math.trunc(file.d)) } : {}),
        ...(Number.isFinite(file?.x) ? { x: Math.max(0, Math.trunc(file.x)) } : {}),
        ...(hasText(file?.stay) ? { stay: String(file.stay).trim() } : {}),
        ...(file?.n ? { n: String(file.n) } : {}),
        ...(typeof file?.c === 'string' && file.c.trim() ? { c: file.c.trim() } : {}),
    };
}

export function makeUnavailableReply() {
    return {
        t: UNAVAILABLE_REPLY_MSG_TYPE,
        c: UNAVAILABLE_REPLY_TEXT,
    };
}

export function canShareAttachmentMsg(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return false;
    }
    if (msg.pending || msg.failed) {
        return false;
    }
    return isAttachmentMsgType(msg?.t) && !isExpiredAttachmentMsg(msg) && hasStoredFileRef(msg);
}

export function makeSharedAttachment(msg) {
    if (!canShareAttachmentMsg(msg)) {
        throw new Error('file unavailable');
    }

    const x = hasText(msg?.stay) && (!Number.isFinite(msg?.x) || msg.x <= Date.now()) ? Date.now() + CHAT_MEDIA_TTL_MS : msg.x;
    return makeAttachment(msg.t, {
        p: msg.p,
        k: msg.k,
        ...(msg?.m ? { m: msg.m } : {}),
        ...(Number.isFinite(msg?.z) ? { z: msg.z } : {}),
        ...(Number.isFinite(msg?.w) ? { w: msg.w } : {}),
        ...(Number.isFinite(msg?.h) ? { h: msg.h } : {}),
        ...(Number.isFinite(msg?.d) ? { d: msg.d } : {}),
        ...(Number.isFinite(x) ? { x } : {}),
        ...(msg?.n ? { n: msg.n } : {}),
        ...(typeof msg?.c === 'string' && msg.c.trim() ? { c: msg.c } : {}),
    });
}

export function makeImg(file) {
    return makeAttachment('img', file);
}

export function makeMp3(file) {
    return makeAttachment('mp3', file);
}

export function makeMp4(file) {
    return makeAttachment('mp4', file);
}

export function makeFile(file) {
    return makeAttachment('file', file);
}

export function isAttachmentMsg(msg) {
    return isAttachmentMsgType(msg?.t) && !isExpiredAttachmentMsg(msg) && hasFileRef(msg);
}
