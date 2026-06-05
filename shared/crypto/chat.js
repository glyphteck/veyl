import { cleanBytes } from './core.js';
import { sealJson, openJson } from './box.js';
import { packBodyData, unpackBodyData } from './pack.js';
import { closePair, derivePairKey, getPairAad, openPair } from './pair.js';
import { sealChatAction, openChatAction } from '../chat/messages/actions.js';

const MSG_SCOPE = 'msg-body';

export function hasMsgHead(data) {
    const head = data?.head;
    return typeof head?.cid === 'string' && !!head.cid;
}

export function hasMsgBody(data) {
    return data?.body != null;
}

export function hasMsgData(data) {
    return hasMsgHead(data) && hasMsgBody(data);
}

export function openChatPair(chatPK, chatPrivKey, peerChatPK, options = {}) {
    return openPair(chatPK, chatPrivKey, peerChatPK, options);
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
    return derivePairKey(pair, MSG_SCOPE, head.cid);
}

function getMsgAad(pair, head) {
    return getPairAad(pair, MSG_SCOPE, head.cid);
}

// Header carries only an opaque client id. Sender identity is encrypted and signed.
export async function sealMsg(pair, message, options = {}) {
    const head = getHead(pair, message);
    const key = getMsgKey(pair, head);
    try {
        const aad = getMsgAad(pair, head);
        const payload = await sealChatAction(pair, getPayload(message), {
            id: head.cid,
            op: options?.op,
            target: options?.target,
            ts: options?.ts,
            auth: options?.auth,
        });
        const { nonce, ct } = await sealJson(key, payload, aad);
        return {
            head,
            body: packBodyData(nonce, ct),
        };
    } finally {
        cleanBytes(key);
    }
}

export async function resealMsgBody(pair, head, message, options = {}) {
    if (!hasMsgHead({ head })) {
        throw new Error('invalid message head');
    }

    const key = getMsgKey(pair, head);
    try {
        const aad = getMsgAad(pair, head);
        const payload = await sealChatAction(pair, getPayload(message), {
            id: options?.id,
            op: options?.op,
            target: options?.target ?? head.cid,
            ts: options?.ts,
            auth: options?.auth,
        });
        const { nonce, ct } = await sealJson(key, payload, aad);
        return packBodyData(nonce, ct);
    } finally {
        cleanBytes(key);
    }
}

export async function openMsg(pair, data, options = {}) {
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
        const opened = openChatAction(payload, {
            chatId: pair.chatId,
            root: pair.root,
            actors: options?.actors,
            allowUnsigned: options?.allowUnsigned,
        });
        if (opened) {
            return {
                ...opened,
                cid: opened.cid || head.cid,
            };
        }
        throw new Error('unsigned chat action');
    } finally {
        cleanBytes(key);
    }
}
