import { cleanText } from './utils/text.js';

export function readAvatarVersion(value) {
    if (value == null || value === '' || (typeof value !== 'number' && typeof value !== 'string')) {
        return null;
    }
    const version = Number(value);
    return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

export function avatarUrlWithVersion(url, version) {
    if (!url) return null;
    return version == null ? url : `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(version))}`;
}

export function cleanAvatarUsername(value) {
    return cleanText(value).replace(/^@+/, '').slice(0, 40);
}

export function isRememberedAvatar(record) {
    return record?.remember === true;
}

export function makeRememberedAvatar(record, uid, account = null) {
    const username = cleanAvatarUsername(account?.username) || cleanAvatarUsername(record?.username);
    return {
        ...(record && typeof record === 'object' ? record : {}),
        uid,
        username,
        remember: true,
        rememberedAt: Number(record?.rememberedAt) || Date.now(),
        lastLoginAt: Number(record?.lastLoginAt) || 0,
        updatedAt: Date.now(),
    };
}

export function readRememberedAvatar(record) {
    if (!record?.uid || !isRememberedAvatar(record)) {
        return null;
    }
    return {
        uid: record.uid,
        username: cleanAvatarUsername(record.username),
        avatar: null,
        rememberedAt: Number(record.rememberedAt) || 0,
        lastLoginAt: Number(record.lastLoginAt) || 0,
    };
}

export function rememberedAvatarMs(record) {
    return Number(record?.lastLoginAt) || Number(record?.rememberedAt) || 0;
}

export function compareRememberedAvatars(a, b) {
    return rememberedAvatarMs(b) - rememberedAvatarMs(a);
}

export function avatarSourceKey(source) {
    if (!source) return '';
    if (typeof source === 'number') return String(source);
    if (typeof source === 'string') return source;
    return cleanText(source?.uri);
}
