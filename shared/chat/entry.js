'use client';

import { canonicalBytes } from '../crypto/canonical.js';
import { cleanBytes, toBytes32, toHex } from '../crypto/core.js';
import { deriveKey } from '../crypto/kdf.js';
import { openJson, sealJson } from '../crypto/box.js';
import { packBodyData, unpackBodyData } from '../crypto/pack.js';
import { cleanText } from '../utils/text.js';
import { normalizeChatSettings } from './ttl.js';

export const CHAT_ENTRY_VERSION = 1;

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
        if (entry?.v !== CHAT_ENTRY_VERSION || !entry?.linkId || !entry?.chatId || !entry?.peerChatPK) {
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
        linkId: pair.linkId,
        chatId: pair.chatId,
        peerChatPK: pair.peerChatPK,
        peerUid: cleanText(fields.peerUid),
        actors: {
            ...(fields.actors || {}),
            [pair.chatPK]: pair.actor.publicKey,
            ...(fields.peerActorPK ? { [pair.peerChatPK]: fields.peerActorPK } : {}),
        },
        settings: normalizeChatSettings(fields.settings),
        preview: fields.preview || null,
        saved: fields.saved || null,
        readMs: Number.isFinite(fields.readMs) ? fields.readMs : null,
    };
}
