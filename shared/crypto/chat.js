import { cleanBytes } from './core.js';
import { sealJson, openJson } from './box.js';
import { packBodyData, unpackBodyData } from './pack.js';
import { closePair, derivePairKey, getChatId, getPairAad, openPair } from './pair.js';

const MSG_SCOPE = 'msg-body';

export { getChatId };

export function hasMsgHead(data) {
    const head = data?.head;
    return typeof head?.from === 'string' && !!head.from && typeof head?.cid === 'string' && !!head.cid;
}

export function hasMsgBody(data) {
    return data?.body != null;
}

export function hasMsgData(data) {
    return hasMsgHead(data) && hasMsgBody(data);
}

export function openChatPair(chatPK, chatPrivKey, peerChatPK) {
    return openPair(chatPK, chatPrivKey, peerChatPK);
}

export function closeChatPair(pair) {
    closePair(pair);
}

function getHead(pair, message) {
    const cid = typeof message?.cid === 'string' && message.cid ? message.cid : null;
    if (!cid) {
        throw new Error('message cid required');
    }

    return {
        from: pair.chatPK,
        cid,
    };
}

function getPayload(message) {
    const payload = { ...(message || {}) };
    delete payload.cid;
    delete payload.from;
    delete payload.s;
    return payload;
}

function getMsgKey(pair, head) {
    return derivePairKey(pair, MSG_SCOPE, head.from, head.cid);
}

function getMsgAad(pair, head) {
    return getPairAad(pair, MSG_SCOPE, head.from, head.cid);
}

// Header stays plain so Firestore can route messages and future ratchet fields can slot in.
export async function sealMsg(pair, message) {
    const head = getHead(pair, message);
    const key = getMsgKey(pair, head);
    try {
        const aad = getMsgAad(pair, head);
        const payload = getPayload(message);
        const { nonce, ct } = await sealJson(key, payload, aad);
        return {
            head,
            body: packBodyData(nonce, ct),
        };
    } finally {
        cleanBytes(key);
    }
}

export async function resealMsgBody(pair, head, message) {
    if (!hasMsgHead({ head })) {
        throw new Error('invalid message head');
    }

    const key = getMsgKey(pair, head);
    try {
        const aad = getMsgAad(pair, head);
        const payload = getPayload(message);
        const { nonce, ct } = await sealJson(key, payload, aad);
        return packBodyData(nonce, ct);
    } finally {
        cleanBytes(key);
    }
}

export async function openMsg(pair, data) {
    if (!hasMsgHead(data)) {
        throw new Error('invalid message head');
    }
    const head = data.head;

    const key = getMsgKey(pair, head);
    try {
        const aad = getMsgAad(pair, head);
        const { nonce, ct } = unpackBodyData(data.body);
        const payload = await openJson(key, nonce, ct, aad);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('invalid message body');
        }
        return {
            ...payload,
            cid: head.cid,
            s: head.from,
            from: head.from,
        };
    } finally {
        cleanBytes(key);
    }
}
