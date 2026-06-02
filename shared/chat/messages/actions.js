'use client';

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalBytes, canonicalJson } from '../../crypto/canonical.js';
import { signChatBytes, verifyChatBytes } from '../../crypto/sign.js';
import { toHex } from '../../crypto/core.js';
import { cleanText } from '../../utils/text.js';

export const CHAT_ACTION_VERSION = 1;

export const CHAT_ACTION_OPS = Object.freeze({
    CREATE: 'create',
    EDIT: 'edit',
    DELETE: 'delete',
    PAY_CONFIRM: 'pay_confirm',
    REACTION: 'rxn',
    READ_RECEIPT: 'rr',
    HIDDEN_CHECKPOINT: 'hid',
    SYSTEM: 'sys',
});

const CHAT_ACTION_OP_SET = new Set(Object.values(CHAT_ACTION_OPS));
const CONTROL_OP_BY_TYPE = Object.freeze({
    rxn: CHAT_ACTION_OPS.REACTION,
    rr: CHAT_ACTION_OPS.READ_RECEIPT,
    hid: CHAT_ACTION_OPS.HIDDEN_CHECKPOINT,
    sys: CHAT_ACTION_OPS.SYSTEM,
});

function cleanRequiredText(value, label) {
    const text = cleanText(value);
    if (!text) {
        throw new Error(`${label} required`);
    }
    return text;
}

function cleanOptionalText(value) {
    return cleanText(value);
}

function cleanActionVersion(value) {
    if (value == null) {
        return CHAT_ACTION_VERSION;
    }
    if (!Number.isInteger(value) || value !== CHAT_ACTION_VERSION) {
        throw new Error('unsupported chat action version');
    }
    return value;
}

function cleanActionTimestamp(value) {
    if (typeof value === 'string') {
        return cleanRequiredText(value, 'chat action ts');
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('chat action ts required');
    }
    return Object.is(value, -0) ? 0 : value;
}

function actorsForVerify(actors) {
    return actors && typeof actors === 'object' && !Array.isArray(actors) ? actors : null;
}

export function isChatActionOp(value) {
    return CHAT_ACTION_OP_SET.has(value);
}

export function cleanChatActionOp(value) {
    const op = cleanRequiredText(value, 'chat action op');
    if (!isChatActionOp(op)) {
        throw new Error('unsupported chat action op');
    }
    return op;
}

export function actionOpForPayload(payload, fallback = CHAT_ACTION_OPS.CREATE) {
    return CONTROL_OP_BY_TYPE[cleanText(payload?.t)] || fallback;
}

export function normalizeChatAction(action, { requireProof = false } = {}) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new Error('chat action required');
    }

    const payload = Object.prototype.hasOwnProperty.call(action, 'payload') ? action.payload : null;
    canonicalJson(payload, 'chat action payload');
    const normalized = {
        v: cleanActionVersion(action.v),
        op: cleanChatActionOp(action.op),
        chat: cleanRequiredText(action.chat, 'chat action chat'),
        id: cleanRequiredText(action.id, 'chat action id'),
        target: cleanOptionalText(action.target),
        actor: cleanRequiredText(action.actor, 'chat action actor'),
        ts: cleanActionTimestamp(action.ts),
        payload,
    };

    const sig = cleanOptionalText(action.sig);
    const auth = cleanOptionalText(action.auth);
    if (sig) {
        normalized.sig = sig;
    }
    if (auth) {
        normalized.auth = auth;
    }
    if (requireProof && !sig && !auth) {
        throw new Error('chat action proof required');
    }

    return normalized;
}

export function chatActionPayloadHash(payload = null) {
    return toHex(sha256(canonicalBytes(payload, 'chat action payload')));
}

export function chatActionProofInput(action) {
    const normalized = normalizeChatAction(action);
    return {
        v: normalized.v,
        op: normalized.op,
        chat: normalized.chat,
        id: normalized.id,
        target: normalized.target,
        actor: normalized.actor,
        ts: normalized.ts,
        payloadHash: chatActionPayloadHash(normalized.payload),
    };
}

export function chatActionProofJson(action) {
    return canonicalJson(chatActionProofInput(action), 'chat action proof');
}

export function chatActionProofBytes(action) {
    return canonicalBytes(chatActionProofInput(action), 'chat action proof');
}

export function chatActionAuth(root, action) {
    return toHex(hmac(sha256, root, chatActionProofBytes(action)));
}

export async function sealChatAction(pair, payload, options = {}) {
    if (!pair?.chatId || !pair?.actor?.publicKey) {
        throw new Error('chat action pair required');
    }
    const action = normalizeChatAction({
        v: CHAT_ACTION_VERSION,
        op: cleanOptionalText(options?.op) || actionOpForPayload(payload),
        chat: pair.chatId,
        id: cleanOptionalText(options?.id) || cleanRequiredText(payload?.cid, 'chat action id'),
        target: cleanOptionalText(options?.target),
        actor: pair.actor.publicKey,
        ts: Number.isFinite(options?.ts) ? options.ts : Date.now(),
        payload: {
            ...(payload || {}),
            s: cleanOptionalText(payload?.s) || pair.chatPK,
        },
    });

    if (options?.auth === true) {
        return {
            ...action,
            auth: chatActionAuth(pair.root, action),
        };
    }
    return {
        ...action,
        sig: signChatBytes(pair.actor, chatActionProofBytes(action)),
    };
}

export function openChatAction(action, options = {}) {
    if (!action || typeof action !== 'object' || Array.isArray(action) || action.v !== CHAT_ACTION_VERSION || !action.op || !action.actor || !('payload' in action)) {
        return null;
    }
    const normalized = normalizeChatAction(action, { requireProof: !options.allowUnsigned });
    if (normalized.chat !== options.chatId) {
        throw new Error('chat action target mismatch');
    }

    const actors = actorsForVerify(options.actors);
    const sender = cleanText(normalized.payload?.s);
    const expectedActor = sender && actors ? cleanText(actors[sender]) : '';
    if (expectedActor && expectedActor !== normalized.actor) {
        throw new Error('chat action actor mismatch');
    }
    if (!expectedActor && actors && normalized.op !== CHAT_ACTION_OPS.DELETE) {
        throw new Error('unknown chat action actor');
    }
    if (normalized.sig && !verifyChatBytes(normalized.actor, normalized.sig, chatActionProofBytes(normalized))) {
        throw new Error('invalid chat action signature');
    }
    if (normalized.auth && (!options.root || chatActionAuth(options.root, normalized) !== normalized.auth)) {
        throw new Error('invalid chat action authenticator');
    }
    if (!normalized.sig && !normalized.auth && !options.allowUnsigned) {
        throw new Error('missing chat action proof');
    }

    return {
        ...normalized.payload,
        id: normalized.target && normalized.op !== CHAT_ACTION_OPS.CREATE ? normalized.target : undefined,
        cid: normalized.id,
        actionId: normalized.id,
        actionOp: normalized.op,
        actionTarget: normalized.target,
        actor: normalized.actor,
        from: sender,
        s: sender,
    };
}
