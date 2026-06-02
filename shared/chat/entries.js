'use client';

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { canonicalBytes } from '../crypto/canonical.js';
import { cleanBytes, fromHex, randomBytes, toBytes32, toHex } from '../crypto/core.js';
import { deriveKey } from '../crypto/kdf.js';
import { getKeyPair } from '../crypto/seed.js';
import { openChatPair } from '../crypto/chat.js';
import { openJson, sealJson } from '../crypto/box.js';
import { packBodyData, unpackBodyData } from '../crypto/pack.js';
import { cleanText } from '../utils/text.js';
import { normalizeChatSettings } from './ttl.js';

export const CHAT_ENTRY_VERSION = 1;
export const CHAT_WAKE_VERSION = 1;

export function ownChatEntryId(chatPrivKey, chatId) {
    const key = deriveKey(toBytes32(chatPrivKey, 'chat private key'), 'user-chat-entry-id-v1', [cleanText(chatId)], 16);
    try {
        return toHex(key);
    } finally {
        cleanBytes(key);
    }
}

function entryKey(chatPrivKey, entryId) {
    return deriveKey(toBytes32(chatPrivKey, 'chat private key'), 'user-chat-entry-v1', [entryId]);
}

function entryAad(entryId) {
    return canonicalBytes({ v: CHAT_ENTRY_VERSION, entryId }, 'chat entry aad');
}

function wakeProofInput(payload) {
    return {
        v: CHAT_WAKE_VERSION,
        kind: cleanText(payload?.kind) || 'wake',
        chatId: cleanText(payload?.chatId),
        senderChatPK: cleanText(payload?.senderChatPK),
        senderUid: cleanText(payload?.senderUid),
        actorPK: cleanText(payload?.actorPK),
        messageId: cleanText(payload?.messageId),
        ts: Number.isFinite(payload?.ts) ? payload.ts : 0,
    };
}

function wakeProof(root, payload) {
    return toHex(hmac(sha256, root, canonicalBytes(wakeProofInput(payload), 'chat wake proof')));
}

export async function sealOwnChatEntry(chatPrivKey, entryId, entry) {
    const key = entryKey(chatPrivKey, entryId);
    try {
        const body = {
            v: CHAT_ENTRY_VERSION,
            ...entry,
            settings: normalizeChatSettings(entry?.settings),
        };
        const { nonce, ct } = await sealJson(key, body, entryAad(entryId));
        return packBodyData(nonce, ct);
    } finally {
        cleanBytes(key);
    }
}

export async function openOwnChatEntry(chatPrivKey, entryId, body) {
    const key = entryKey(chatPrivKey, entryId);
    try {
        const { nonce, ct } = unpackBodyData(body);
        const entry = await openJson(key, nonce, ct, entryAad(entryId));
        if (entry?.v !== CHAT_ENTRY_VERSION || !entry?.chatId || !entry?.peerChatPK) {
            throw new Error('invalid chat entry');
        }
        return {
            ...entry,
            settings: normalizeChatSettings(entry.settings),
        };
    } finally {
        cleanBytes(key);
    }
}

export function makeOwnChatEntry(pair, fields = {}) {
    return {
        chatId: pair.chatId,
        peerChatPK: pair.peerChatPK,
        peerUid: cleanText(fields.peerUid),
        actors: {
            ...(fields.actors || {}),
            [pair.chatPK]: pair.actor.publicKey,
            ...(fields.peerActorPK ? { [pair.peerChatPK]: fields.peerActorPK } : {}),
        },
        settings: normalizeChatSettings(fields.settings),
        lastMsg: fields.lastMsg || null,
        saved: fields.saved || null,
        readMs: Number.isFinite(fields.readMs) ? fields.readMs : null,
    };
}

export async function sealChatWake(senderChatPK, senderPrivKey, recipientChatPK, fields = {}) {
    const pair = await openChatPair(senderChatPK, senderPrivKey, recipientChatPK);
    const eph = getKeyPair(randomBytes(32));
    const recipientPK = fromHex(recipientChatPK, 'recipient chat public key');
    const shared = x25519.getSharedSecret(eph.priv, recipientPK);
    const epk = toHex(eph.pub);
    const key = deriveKey(shared.subarray(0, 32), 'chat-inbox-wake-v1', [epk, recipientChatPK]);
    try {
        const payload = {
            v: CHAT_WAKE_VERSION,
            kind: cleanText(fields.kind) || 'wake',
            chatId: pair.chatId,
            senderChatPK,
            senderUid: cleanText(fields.senderUid),
            actorPK: pair.actor.publicKey,
            messageId: cleanText(fields.messageId),
            ts: Number.isFinite(fields.ts) ? fields.ts : Date.now(),
        };
        const sealedPayload = {
            ...payload,
            proof: wakeProof(pair.root, payload),
        };
        const { nonce, ct } = await sealJson(key, sealedPayload, canonicalBytes({ v: CHAT_WAKE_VERSION, epk }, 'chat wake aad'));
        return {
            v: CHAT_WAKE_VERSION,
            epk,
            body: packBodyData(nonce, ct),
        };
    } finally {
        cleanBytes(pair.root, pair.actor?.secret, eph.priv, shared, key);
    }
}

export async function openChatWake(chatPK, chatPrivKey, wake) {
    if (wake?.v !== CHAT_WAKE_VERSION || !wake?.epk || !wake?.body) {
        throw new Error('invalid chat wake');
    }
    const priv = toBytes32(chatPrivKey, 'chat private key');
    const epk = cleanText(wake.epk);
    const shared = x25519.getSharedSecret(priv, fromHex(epk, 'chat wake public key'));
    const key = deriveKey(shared.subarray(0, 32), 'chat-inbox-wake-v1', [epk, chatPK]);
    try {
        const { nonce, ct } = unpackBodyData(wake.body);
        const payload = await openJson(key, nonce, ct, canonicalBytes({ v: CHAT_WAKE_VERSION, epk }, 'chat wake aad'));
        const senderChatPK = cleanText(payload?.senderChatPK);
        if (!senderChatPK || payload?.v !== CHAT_WAKE_VERSION) {
            throw new Error('invalid chat wake payload');
        }
        const pair = await openChatPair(chatPK, chatPrivKey, senderChatPK);
        if (payload.chatId !== pair.chatId || payload.proof !== wakeProof(pair.root, payload)) {
            throw new Error('invalid chat wake proof');
        }
        return {
            pair,
            payload: {
                ...payload,
                senderChatPK,
                actorPK: cleanText(payload.actorPK),
            },
        };
    } finally {
        cleanBytes(shared, key);
    }
}
