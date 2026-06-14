'use client';

import { canonicalBytes } from './crypto/canonical.js';
import { cleanBytes, toBytes } from './crypto/core.js';
import { deriveKey } from './crypto/kdf.js';
import { openJson, sealJson } from './crypto/box.js';
import { packBodyData, unpackBodyData } from './crypto/pack.js';
import { defaultSettings, normalizeSettings } from './settings.js';
import { cleanText } from './utils/text.js';

export const USER_SETTINGS_VERSION = 1;

function settingsAad(uid) {
    return canonicalBytes({ v: USER_SETTINGS_VERSION, uid: cleanText(uid) }, 'user settings aad');
}

export function deriveSettingsKey(cacheSeed, uid) {
    const seed = toBytes(cacheSeed, 'settings seed');
    if (seed.length !== 32) {
        throw new Error('settings seed required');
    }
    const user = cleanText(uid);
    if (!user) {
        throw new Error('settings uid required');
    }
    return deriveKey(seed, 'user-settings-v1', [user]);
}

export async function sealSettings(key, uid, settings) {
    const normalized = normalizeSettings(settings || defaultSettings);
    const { nonce, ct } = await sealJson(toBytes(key, 'settings key'), {
        v: USER_SETTINGS_VERSION,
        settings: normalized,
    }, settingsAad(uid));
    return packBodyData(nonce, ct);
}

export async function openSettings(key, uid, body) {
    const data = toBytes(body, 'settings body');
    const { nonce, ct } = unpackBodyData(data);
    const opened = await openJson(toBytes(key, 'settings key'), nonce, ct, settingsAad(uid));
    if (opened?.v !== USER_SETTINGS_VERSION) {
        throw new Error('unsupported settings body');
    }
    return normalizeSettings(opened.settings || defaultSettings);
}

export function clearSettingsKey(key) {
    cleanBytes(key);
}
