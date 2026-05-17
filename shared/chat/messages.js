'use client';

import { renderMoney } from '../utils.js';
import { getMessageOrderMs } from './state.js';
import { getChatFileChatId } from './filepayload.js';

export const ATTACHMENT_MSG_TYPES = ['img', 'mp3', 'mp4', 'file'];
export const MAX_TXT_CHARS = 2048;
export const READ_RECEIPT_MSG_TYPE = 'rr';
export const REACTION_MSG_TYPE = 'rxn';
export const DEFAULT_REACTION_EMOJI = '❤️';
export const MAX_REACTIONS = 2;

function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function cleanUrl(value) {
    return String(value ?? '').trim();
}

export function getLinkUrl(value) {
    const raw = cleanUrl(value);
    if (!raw || /\s/.test(raw)) {
        return '';
    }

    const candidate = /^https?:\/\//i.test(raw) ? raw : /^(www\.|[a-z0-9.-]+\.[a-z]{2,}(?=[:/?#]|$))/i.test(raw) ? `https://${raw}` : raw;
    if (!/^https?:\/\//i.test(candidate) || /[<>"'`]/.test(candidate)) {
        return '';
    }

    if (typeof URL === 'function') {
        try {
            const url = new URL(candidate);
            return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
        } catch {
            return '';
        }
    }

    return /^https?:\/\/[^/?#]+\.[^/?#]+/i.test(candidate) ? candidate : '';
}

export function isLinkText(value) {
    return !!getLinkUrl(value);
}

export function splitLinks(text) {
    const value = String(text ?? '');
    const parts = [];
    const pattern = /https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|[a-z0-9.-]+\.[a-z]{2,}(?=[:/?#]|$)[^\s<>"'`]*/gi;
    let index = 0;
    let match;

    while ((match = pattern.exec(value))) {
        const raw = match[0];
        const url = getLinkUrl(raw.replace(/[),.;!?]+$/, ''));
        if (!url) {
            continue;
        }

        const end = match.index + raw.length;
        const cleanEnd = match.index + raw.replace(/[),.;!?]+$/, '').length;
        if (match.index > index) {
            parts.push({ t: 'txt', c: value.slice(index, match.index) });
        }
        parts.push({ t: 'lnk', c: value.slice(match.index, cleanEnd), u: url });
        if (cleanEnd < end) {
            parts.push({ t: 'txt', c: value.slice(cleanEnd, end) });
        }
        index = end;
    }

    if (index < value.length) {
        parts.push({ t: 'txt', c: value.slice(index) });
    }

    return parts.length ? parts : [{ t: 'txt', c: value }];
}

function hasFileRef(msg) {
    if (!hasText(msg?.p) || !hasText(msg?.k)) {
        return false;
    }
    if (String(msg.p).startsWith('local:') || msg.k === 'local') {
        return true;
    }
    return true;
}

function hasStoredFileRef(msg) {
    if (!hasText(msg?.p) || !hasText(msg?.k)) {
        return false;
    }
    if (String(msg.p).startsWith('local:') || msg.k === 'local') {
        return false;
    }

    try {
        getChatFileChatId(msg.p);
        return true;
    } catch {
        return false;
    }
}

function charLength(value) {
    return Array.from(String(value ?? '')).length;
}

function cleanReactionUser(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function cleanReactionEmoji(value) {
    const emoji = typeof value === 'string' ? value.trim() : '';
    return emoji || DEFAULT_REACTION_EMOJI;
}

function cleanReactionTarget(value) {
    const target = typeof value === 'object' && value ? msgKey(value) : value;
    return typeof target === 'string' ? target.trim() : '';
}

export function getMsgReactions(msg) {
    const raw = Array.isArray(msg?.reactions) ? msg.reactions : [];
    const seen = new Set();
    const reactions = [];

    for (const item of raw) {
        const user = cleanReactionUser(item?.user);
        const emoji = cleanReactionEmoji(item?.emoji);
        if (!user || seen.has(user)) {
            continue;
        }
        seen.add(user);
        reactions.push({ emoji, user });
        if (reactions.length >= MAX_REACTIONS) {
            break;
        }
    }

    return reactions;
}

export function isLongTxt(msg) {
    return msg?.t === 'txt' && typeof msg.c === 'string' && charLength(msg.c) > MAX_TXT_CHARS;
}

export function makeTxtFileName(text) {
    const first =
        String(text ?? '')
            .trim()
            .split(/\s+/)[0] || 'message';
    const clean = first.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
    const base = Array.from(clean).slice(0, 12).join('');
    return `${base || 'message'}.txt`;
}

export function isPeerMsg(msg, chatPK) {
    const sender = typeof msg?.s === 'string' ? msg.s.trim() : '';
    const user = typeof chatPK === 'string' ? chatPK.trim() : '';
    return !!sender && !!user && sender !== user;
}

function isServerConfirmedMsg(msg) {
    return !!msg?.id && !String(msg.id).startsWith('local:') && !msg.pending && !msg.failed;
}

function msgKey(msg) {
    return msg?.cid || msg?.id || null;
}

export function makeReadReceipt(target) {
    const upto = String(target?.cid || target?.id || target || '').trim();
    if (!upto) {
        throw new Error('read receipt target required');
    }
    return { t: READ_RECEIPT_MSG_TYPE, upto };
}

export function isReadReceiptMsg(msg) {
    return msg?.t === READ_RECEIPT_MSG_TYPE && hasText(msg.upto);
}

export function makeReaction(target, emoji = DEFAULT_REACTION_EMOJI) {
    const nextTarget = cleanReactionTarget(target);
    if (!nextTarget) {
        throw new Error('reaction target required');
    }

    const nextEmoji = emoji == null ? '' : cleanReactionEmoji(emoji);
    return {
        t: REACTION_MSG_TYPE,
        target: nextTarget,
        ...(nextEmoji ? { emoji: nextEmoji } : {}),
    };
}

export function isReactionMsg(msg) {
    return msg?.t === REACTION_MSG_TYPE && hasText(msg.target) && (msg.emoji == null || hasText(msg.emoji));
}

export function isControlMsg(msg) {
    return isReadReceiptMsg(msg) || isReactionMsg(msg);
}

export function canStoreMsg(msg) {
    return canShowMsg(msg) || isControlMsg(msg);
}

function sameReactions(a, b) {
    const left = getMsgReactions({ reactions: a });
    const right = getMsgReactions({ reactions: b });
    if (left.length !== right.length) {
        return false;
    }
    return left.every((reaction, index) => reaction.user === right[index]?.user && reaction.emoji === right[index]?.emoji);
}

export function deriveMessageReactions(messages, chatPK, peerChatPK) {
    const participants = [chatPK, peerChatPK].filter(Boolean);
    if (!Array.isArray(messages) || !messages.length || !participants.length) {
        return messages || [];
    }

    const allowed = new Set(participants);
    const byTarget = new Map();

    for (const msg of messages) {
        if (!isServerConfirmedMsg(msg) || !isReactionMsg(msg)) {
            continue;
        }

        const user = cleanReactionUser(msg.s || msg.from);
        const target = cleanReactionTarget(msg.target);
        if (!user || !allowed.has(user) || !target) {
            continue;
        }

        let reactions = byTarget.get(target);
        if (!reactions) {
            reactions = new Map();
            byTarget.set(target, reactions);
        }

        if (hasText(msg.emoji)) {
            reactions.set(user, { emoji: cleanReactionEmoji(msg.emoji), user });
        } else {
            reactions.delete(user);
        }
    }

    return messages.map((msg) => {
        if (!canShowMsg(msg)) {
            return msg;
        }

        const target = msgKey(msg);
        const reactionsByUser = target ? byTarget.get(target) : null;
        const reactions = participants.map((user) => reactionsByUser?.get(user)).filter(Boolean).slice(0, MAX_REACTIONS);
        if (sameReactions(msg.reactions, reactions)) {
            return msg;
        }

        const { reactions: _oldReactions, ...next } = msg;
        return reactions.length ? { ...next, reactions } : next;
    });
}

export function getLatestReadReceiptTarget(messages, chatPK) {
    let latestSentReceipt = null;
    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (!isServerConfirmedMsg(msg)) {
            continue;
        }

        if (!isPeerMsg(msg, chatPK) && isReadReceiptMsg(msg) && !latestSentReceipt) {
            latestSentReceipt = msg;
            continue;
        }

        if (isPeerMsg(msg, chatPK) && canShowMsg(msg)) {
            return latestSentReceipt?.upto === msgKey(msg) ? null : msg;
        }
    }
    return null;
}

export function getLatestOwnReadReceiptTarget(messages, chatPK) {
    let target = null;
    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (isServerConfirmedMsg(msg) && !isPeerMsg(msg, chatPK) && isReadReceiptMsg(msg)) {
            target = msg.upto;
            break;
        }
    }

    if (!target) {
        return null;
    }

    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (isServerConfirmedMsg(msg) && isPeerMsg(msg, chatPK) && canShowMsg(msg) && msgKey(msg) === target) {
            return msg;
        }
    }
    return null;
}

export function getLatestReadOutgoingReceipt(messages, chatPK, peerChatPK) {
    let target = null;
    let receipt = null;
    let receiptOrderMs = Infinity;
    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (isServerConfirmedMsg(msg) && isPeerMsg(msg, chatPK) && msg?.s === peerChatPK && isReadReceiptMsg(msg)) {
            target = msg.upto;
            receipt = msg;
            receiptOrderMs = getMessageOrderMs(msg);
            break;
        }
    }

    if (!target) {
        return null;
    }

    let fallback = null;
    const targetOrderMs = getMessageOrderMs({ cid: target });
    const fallbackMaxOrderMs = Number.isFinite(targetOrderMs) ? targetOrderMs : receiptOrderMs;
    for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (!isServerConfirmedMsg(msg) || isPeerMsg(msg, chatPK) || !canShowMsg(msg)) {
            continue;
        }
        if (msgKey(msg) === target) {
            return { message: msg, receipt };
        }
        if (!fallback && getMessageOrderMs(msg) <= fallbackMaxOrderMs) {
            fallback = msg;
        }
    }
    return fallback ? { message: fallback, receipt } : null;
}

export function getLatestReadOutgoingReceiptMessage(messages, chatPK, peerChatPK) {
    return getLatestReadOutgoingReceipt(messages, chatPK, peerChatPK)?.message ?? null;
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

export function makeTxt(text) {
    const c = typeof text === 'string' ? text.trim() : '';
    if (!c) {
        throw new Error('text required');
    }
    return { t: 'txt', c };
}

export function setTxt(msg, text) {
    const c = typeof text === 'string' ? text.trim() : '';
    if (!c) {
        throw new Error('text required');
    }
    return {
        ...(typeof msg?.s === 'string' && msg.s ? { s: msg.s } : {}),
        ...(typeof msg?.cid === 'string' && msg.cid ? { cid: msg.cid } : {}),
        ...(typeof msg?.r === 'string' && msg.r ? { r: msg.r } : {}),
        t: 'txt',
        c,
    };
}

export function setReply(msg, replyId) {
    const nextReplyId = String(replyId ?? '').trim();
    if (!nextReplyId) {
        return { ...(msg || {}) };
    }
    return {
        ...(msg || {}),
        r: nextReplyId,
    };
}

export function canReplyToMsg(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return false;
    }
    if (msg.pending || msg.failed) {
        return false;
    }
    if (!canShowMsg(msg)) {
        return false;
    }
    return !!(msg.id || msg.cid);
}

export function makeReq(amount) {
    const a = String(amount ?? '').trim();
    if (!a) {
        throw new Error('amount required');
    }
    return { t: 'req', a };
}

export function setReqTx(msg, tx) {
    const a = String(msg?.a ?? '').trim();
    const nextTx = String(tx ?? '').trim();
    if (!a || !nextTx) {
        throw new Error('request and tx required');
    }
    return {
        ...(typeof msg?.s === 'string' && msg.s ? { s: msg.s } : {}),
        ...(typeof msg?.cid === 'string' && msg.cid ? { cid: msg.cid } : {}),
        ...(typeof msg?.r === 'string' && msg.r ? { r: msg.r } : {}),
        t: 'req',
        a,
        tx: nextTx,
    };
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
        ...(file?.n ? { n: String(file.n) } : {}),
        ...(typeof file?.c === 'string' && file.c.trim() ? { c: file.c.trim() } : {}),
    };
}

export function canShareAttachmentMsg(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return false;
    }
    if (msg.pending || msg.failed) {
        return false;
    }
    return isAttachmentMsgType(msg?.t) && hasStoredFileRef(msg);
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
    return isAttachmentMsgType(msg?.t) && hasFileRef(msg);
}

export function canShowMsg(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return false;
    }

    switch (msg.t) {
        case 'txt':
            return hasText(msg.c);
        case 'req':
            return hasText(msg.a);
        default:
            return isAttachmentMsg(msg);
    }
}

export function getReplyPreview(msg) {
    if (!msg || typeof msg !== 'object') {
        return '';
    }
    if (msg.t === 'txt' && hasText(msg.c)) {
        return msg.c.trim();
    }
    if (msg.t === 'req') {
        return msg.tx ? 'payment' : 'payment request';
    }
    if (isAttachmentMsgType(msg?.t)) {
        return getAttachmentCaption(msg) || getAttachmentTitle(msg);
    }
    return '';
}

export function getMsgPreview(lastMsg, chatPK, settings, btcPrice) {
    if (!lastMsg) return '';
    if (typeof lastMsg === 'string') return lastMsg;
    if (lastMsg.t === 'txt' && typeof lastMsg.c === 'string') return lastMsg.c;
    if (lastMsg.t === 'img') return 'sent an image';
    if (lastMsg.t === 'mp3') return 'sent audio';
    if (lastMsg.t === 'mp4') return 'sent a video';
    if (isAttachmentMsgType(lastMsg?.t)) return 'sent a file';
    if (!canShowMsg(lastMsg)) return '';
    if (lastMsg.t === 'req') {
        const amount = Number(lastMsg.a || 0);
        const formattedAmount = renderMoney(amount, settings?.moneyFormat || 'btc', btcPrice);
        return lastMsg.tx ? `received ${formattedAmount}` : `requested ${formattedAmount}`;
    }
    if (typeof lastMsg.c === 'string') return lastMsg.c;
    if (typeof lastMsg.text === 'string') return lastMsg.text;
    return 'sent a message';
}
