'use client';

import { x25519 } from '@noble/curves/ed25519.js';
import { cleanBytes, toBytes32 } from './core.js';
import { deriveKey, encodeScope } from './kdf.js';

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

export function getChatId(chatPK, peerChatPK) {
    return orderChatKeys(chatPK, peerChatPK).join('_');
}

export async function openPair(chatPK, chatPrivKey, peerChatPK) {
    const privKeyBytes = toBytes32(chatPrivKey, 'private');
    const pubKeyBytes = toBytes32(peerChatPK, 'public');
    const sharedSecret = x25519.getSharedSecret(privKeyBytes, pubKeyBytes);
    if (!(sharedSecret instanceof Uint8Array) || sharedSecret.length < 32) {
        throw new Error('invalid shared secret');
    }

    const chatId = getChatId(chatPK, peerChatPK);
    const root = deriveKey(sharedSecret.subarray(0, 32), 'pair-root', [chatId]);
    cleanBytes(sharedSecret);
    return { chatId, chatPK, peerChatPK, root };
}

export function closePair(pair) {
    cleanBytes(pair?.root);
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
