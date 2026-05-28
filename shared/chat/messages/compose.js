import { canShowMsg, isSystemMsg } from './control.js';
import { retentionPatch } from './retention.js';

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
    if (!canShowMsg(msg) || isSystemMsg(msg)) {
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
        ...retentionPatch(msg),
        t: 'req',
        a,
        tx: nextTx,
    };
}
