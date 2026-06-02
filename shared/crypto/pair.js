'use client';

import { x25519 } from '@noble/curves/ed25519.js';
import { cleanBytes, toBytes32, toHex } from './core.js';
import { deriveKey, encodeScope } from './kdf.js';
import { getChatActorKey } from './sign.js';

export function compareKeys(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

export function orderChatKeys(chatPK, peerChatPK) {
    if (!chatPK || !peerChatPK) {
        throw new Error('chat keys required');
    }
    // Firestore rules compare chat keys with raw string ordering, so do the same here.
    return compareKeys(chatPK, peerChatPK) <= 0 ? [chatPK, peerChatPK] : [peerChatPK, chatPK];
}

function getOpaqueChatId(sharedSecret, chatPK, peerChatPK) {
    return toHex(deriveKey(sharedSecret, 'opaque-chat-id-v1', orderChatKeys(chatPK, peerChatPK), 32));
}

export async function openPair(chatPK, chatPrivKey, peerChatPK) {
    const privKeyBytes = toBytes32(chatPrivKey, 'private');
    const pubKeyBytes = toBytes32(peerChatPK, 'public');
    const sharedSecret = x25519.getSharedSecret(privKeyBytes, pubKeyBytes);
    if (!(sharedSecret instanceof Uint8Array) || sharedSecret.length < 32) {
        throw new Error('invalid shared secret');
    }

    const secret = sharedSecret.subarray(0, 32);
    const orderedKeys = orderChatKeys(chatPK, peerChatPK);
    const chatId = getOpaqueChatId(secret, chatPK, peerChatPK);
    const root = deriveKey(secret, 'pair-root-v2', [chatId, ...orderedKeys]);
    const actor = getChatActorKey(privKeyBytes, chatId, chatPK, peerChatPK);
    cleanBytes(sharedSecret);
    return { chatId, chatPK, peerChatPK, root, actor };
}

export function closePair(pair) {
    cleanBytes(pair?.root, pair?.actor?.secret);
}

export function derivePairKey(pair, scope, ...parts) {
    if (!pair?.root || !pair?.chatId) {
        throw new Error('pair root missing');
    }
    return deriveKey(pair.root, scope, [pair.chatId, ...parts]);
}

export function getPairAad(pair, scope, ...parts) {
    if (!pair?.chatId) {
        throw new Error('pair chat id missing');
    }
    return encodeScope(scope, [pair.chatId, ...parts]);
}
