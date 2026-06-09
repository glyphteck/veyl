'use client';

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { canonicalBytes } from '../crypto/canonical.js';
import { cleanBytes, fromHex, randomBytes, toBytes32, toHex } from '../crypto/core.js';
import { deriveKey } from '../crypto/kdf.js';
import { getKeyPair } from '../crypto/seed.js';
import { closeChatPair, openChatPair } from '../crypto/chat.js';
import { openJson, sealJson } from '../crypto/box.js';
import { packBodyData, unpackBodyData } from '../crypto/pack.js';
import { cleanText } from '../utils/text.js';

export const CHAT_PING_VERSION = 1;

function pingProofInput(payload) {
    return {
        v: CHAT_PING_VERSION,
        kind: cleanText(payload?.kind) || 'ping',
        linkId: cleanText(payload?.linkId),
        chatId: cleanText(payload?.chatId),
        senderChatPK: cleanText(payload?.senderChatPK),
        senderUid: cleanText(payload?.senderUid),
        actorPK: cleanText(payload?.actorPK),
        messageId: cleanText(payload?.messageId),
        ts: Number.isFinite(payload?.ts) ? payload.ts : 0,
    };
}

function pingProof(root, payload) {
    return toHex(hmac(sha256, root, canonicalBytes(pingProofInput(payload), 'chat ping proof')));
}

export async function sealPing(senderChatPK, senderPrivKey, recipientChatPK, fields = {}) {
    let pair = null;
    let eph = null;
    let shared = null;
    let key = null;
    try {
        pair = await openChatPair(senderChatPK, senderPrivKey, recipientChatPK, { chatId: fields.chatId });
        if (!pair?.chatId || !pair?.actor?.publicKey || !pair?.linkRoot) {
            throw new Error('chat ping pair required');
        }
        eph = getKeyPair(randomBytes(32));
        const recipientPK = fromHex(recipientChatPK, 'recipient chat public key');
        shared = x25519.getSharedSecret(eph.priv, recipientPK);
        const epk = toHex(eph.pub);
        key = deriveKey(shared.subarray(0, 32), 'chat-inbox-ping-v1', [epk, recipientChatPK]);
        const payload = {
            v: CHAT_PING_VERSION,
            kind: cleanText(fields.kind) || 'ping',
            linkId: pair.linkId,
            chatId: pair.chatId,
            senderChatPK,
            senderUid: cleanText(fields.senderUid),
            actorPK: pair.actor.publicKey,
            messageId: cleanText(fields.messageId),
            ts: Number.isFinite(fields.ts) ? fields.ts : Date.now(),
        };
        const sealedPayload = {
            ...payload,
            proof: pingProof(pair.linkRoot, payload),
        };
        const { nonce, ct } = await sealJson(key, sealedPayload, canonicalBytes({ v: CHAT_PING_VERSION, epk }, 'chat ping aad'));
        return {
            v: CHAT_PING_VERSION,
            epk,
            body: packBodyData(nonce, ct),
        };
    } finally {
        closeChatPair(pair);
        cleanBytes(eph?.priv, shared, key);
    }
}

export async function openPing(chatPK, chatPrivKey, ping) {
    if (ping?.v !== CHAT_PING_VERSION || !ping?.epk || !ping?.body) {
        throw new Error('invalid chat ping');
    }
    let linkPair = null;
    const priv = toBytes32(chatPrivKey, 'chat private key');
    const epk = cleanText(ping.epk);
    const shared = x25519.getSharedSecret(priv, fromHex(epk, 'chat ping public key'));
    const key = deriveKey(shared.subarray(0, 32), 'chat-inbox-ping-v1', [epk, chatPK]);
    try {
        const { nonce, ct } = unpackBodyData(ping.body);
        const payload = await openJson(key, nonce, ct, canonicalBytes({ v: CHAT_PING_VERSION, epk }, 'chat ping aad'));
        const senderChatPK = cleanText(payload?.senderChatPK);
        if (!senderChatPK || payload?.v !== CHAT_PING_VERSION) {
            throw new Error('invalid chat ping payload');
        }
        linkPair = await openChatPair(chatPK, chatPrivKey, senderChatPK);
        if (payload.linkId !== linkPair.linkId || payload.proof !== pingProof(linkPair.linkRoot, payload)) {
            throw new Error('invalid chat ping proof');
        }
        const pair = await openChatPair(chatPK, chatPrivKey, senderChatPK, { chatId: payload.chatId });
        if (!pair?.chatId || !pair?.actor?.publicKey) {
            closeChatPair(pair);
            throw new Error('invalid chat ping chat');
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
        closeChatPair(linkPair);
        cleanBytes(shared, key);
    }
}
