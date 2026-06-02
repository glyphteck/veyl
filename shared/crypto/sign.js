'use client';

import { ed25519 } from '@noble/curves/ed25519.js';
import { cleanBytes, fromHex, fromHexBytes, toBytes, toHex } from './core.js';
import { deriveKey } from './kdf.js';

export const CHAT_ACTOR_SIGN_SCOPE = 'chat-actor-sign-v1';

function orderKeys(a, b) {
    if (!a || !b) {
        throw new Error('chat keys required');
    }
    return a <= b ? [a, b] : [b, a];
}

export function deriveChatActorSecret(chatPrivKey, chatId, chatPK, peerChatPK) {
    if (!chatPrivKey || !chatId || !chatPK || !peerChatPK) {
        throw new Error('chat actor key material required');
    }
    return deriveKey(toBytes(chatPrivKey, 'chat private key'), CHAT_ACTOR_SIGN_SCOPE, [chatId, ...orderKeys(chatPK, peerChatPK)]);
}

export function getChatActorKey(chatPrivKey, chatId, chatPK, peerChatPK) {
    const secret = deriveChatActorSecret(chatPrivKey, chatId, chatPK, peerChatPK);
    try {
        return {
            secret,
            publicKey: toHex(ed25519.getPublicKey(secret)),
        };
    } catch (error) {
        cleanBytes(secret);
        throw error;
    }
}

export function closeChatActorKey(key) {
    cleanBytes(key?.secret);
}

export function signChatBytes(actorKey, bytes) {
    if (!actorKey?.secret || !actorKey?.publicKey) {
        throw new Error('chat actor key required');
    }
    return toHex(ed25519.sign(toBytes(bytes, 'signing bytes'), actorKey.secret));
}

export function verifyChatBytes(publicKey, sig, bytes) {
    try {
        return ed25519.verify(fromHexBytes(sig, 'chat signature'), toBytes(bytes, 'signed bytes'), fromHex(publicKey, 'chat actor public key'));
    } catch {
        return false;
    }
}
