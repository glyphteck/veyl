'use client';

import { openMsg, sealMsg } from '../crypto/chat.js';
import { normalizeChatSettings } from './ttl.js';
import { makeCid } from './state.js';

export const CHAT_SETTINGS_MSG_TYPE = 'cfg';

export function isEncryptedChatSettings(settings) {
    return !!settings && typeof settings === 'object' && !Array.isArray(settings) && !!settings.head && settings.body != null;
}

export async function sealChatSettingsForPair(pair, settings) {
    const normalized = normalizeChatSettings(settings);
    return sealMsg(pair, {
        cid: makeCid(),
        t: CHAT_SETTINGS_MSG_TYPE,
        retention: normalized.retention,
    });
}

export async function openChatSettingsForPair(pair, settings) {
    if (settings == null) {
        return normalizeChatSettings(null);
    }
    if (!isEncryptedChatSettings(settings)) {
        return normalizeChatSettings(null);
    }

    try {
        const payload = await openMsg(pair, settings);
        return normalizeChatSettings(payload);
    } catch {
        return normalizeChatSettings(null);
    }
}
