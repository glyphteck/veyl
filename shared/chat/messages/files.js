import { getChatMediaFileRef, getMediaFileRef, getSharedMediaFileRef } from '../filepayload.js';
import { formatBytes } from '../../utils/display.js';
import { cleanText, lowerText } from '../../utils/text.js';
import { nonNegativeInt } from '../../utils/number.js';
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
        getMediaFileRef(msg.p);
        return true;
    } catch {
        return false;
    }
}

export function hasChatMediaFileRef(msg) {
    if (!hasText(msg?.p) || !hasText(msg?.k) || hasLocalFileRef(msg)) {
        return false;
    }

    try {
        getChatMediaFileRef(msg.p);
        return true;
    } catch {
        return false;
    }
}

export function hasSharedMediaFileRef(msg) {
    if (!hasText(msg?.p) || !hasText(msg?.k) || hasLocalFileRef(msg)) {
        return false;
    }

    try {
        getSharedMediaFileRef(msg.p);
        return true;
    } catch {
        return false;
    }
}

export function storedFileKey(peerChatPK, msg, { type = false } = {}) {
    return [peerChatPK || '', ...(type ? [msg?.t || 'file'] : []), msg?.p || '', msg?.k || ''].join(':');
}

function hasFileRef(msg) {
    return hasLocalFileRef(msg) || hasStoredFileRef(msg);
}

export function formatAttachmentSize(value) {
    return formatBytes(value);
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

function isPermanentAttachmentMsg(msg) {
    return msg?.permanent === true || (Object.prototype.hasOwnProperty.call(msg || {}, 'ttl') && msg.ttl == null);
}

export function isExpiredAttachmentMsg(msg, now = Date.now()) {
    return isAttachmentMsgType(msg?.t) && !isPermanentAttachmentMsg(msg) && Number.isFinite(msg?.x) && msg.x <= now;
}

export function getImageAspect(msg, fallback = 4 / 3) {
    const width = Number(msg?.w);
    const height = Number(msg?.h);
    if (width > 0 && height > 0) {
        return width / height;
    }
    return fallback;
}

export function isPngMsg(msg) {
    return lowerText(msg?.m) === 'image/png';
}

export function isAttachmentMsgType(type) {
    return ATTACHMENT_MSG_TYPES.includes(type);
}

function numberField(key, value) {
    const next = nonNegativeInt(value, null);
    return next == null ? {} : { [key]: next };
}

export function makeAttachment(t, file) {
    if (!isAttachmentMsgType(t)) {
        throw new Error('attachment type required');
    }

    const p = cleanText(file?.p);
    const k = cleanText(file?.k);
    if (!p || !k) {
        throw new Error('file path and key required');
    }

    return {
        t,
        p,
        k,
        ...(file?.m ? { m: String(file.m) } : {}),
        ...numberField('z', file?.z),
        ...numberField('w', file?.w),
        ...numberField('h', file?.h),
        ...numberField('d', file?.d),
        ...numberField('x', file?.x),
        ...(file?.n ? { n: String(file.n) } : {}),
        ...(hasText(file?.c) ? { c: cleanText(file.c) } : {}),
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

    return makeAttachment(msg.t, {
        p: msg.p,
        k: msg.k,
        ...(msg?.m ? { m: msg.m } : {}),
        ...(Number.isFinite(msg?.z) ? { z: msg.z } : {}),
        ...(Number.isFinite(msg?.w) ? { w: msg.w } : {}),
        ...(Number.isFinite(msg?.h) ? { h: msg.h } : {}),
        ...(Number.isFinite(msg?.d) ? { d: msg.d } : {}),
        ...(Number.isFinite(msg?.x) ? { x: msg.x } : {}),
        ...(msg?.n ? { n: msg.n } : {}),
        ...(hasText(msg?.c) ? { c: cleanText(msg.c) } : {}),
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
