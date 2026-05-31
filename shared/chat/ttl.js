'use client';

import { CHAT_SEEN_TTL_MS, CHAT_UNSAVED_TTL_MS, DAY_MS as CONFIG_DAY_MS } from '../config.js';
import { cleanText } from '../utils/text.js';
import { timestampMs } from '../utils/time.js';

export const CHAT_RETENTION_SEEN = 'seen';
export const CHAT_RETENTION_24H = '24h';
export const DEFAULT_CHAT_RETENTION = CHAT_RETENTION_24H;
export const CHAT_RETENTION_VALUES = Object.freeze([CHAT_RETENTION_SEEN, CHAT_RETENTION_24H]);
export const CHAT_RETENTION_LABELS = Object.freeze({
    [CHAT_RETENTION_SEEN]: 'on seen',
    [CHAT_RETENTION_24H]: '24h after seen',
});

export const DAY_MS = CONFIG_DAY_MS;
export const DEFAULT_MESSAGE_TTL_MS = CHAT_UNSAVED_TTL_MS;
export const SEEN_MESSAGE_TTL_MS = CHAT_SEEN_TTL_MS;

export function hasChatRetention(value) {
    const retention = cleanText(value);
    return CHAT_RETENTION_VALUES.includes(retention);
}

export function cleanChatRetention(value) {
    const retention = cleanText(value);
    return hasChatRetention(retention) ? retention : DEFAULT_CHAT_RETENTION;
}

export function normalizeChatSettings(settings) {
    const retention = cleanChatRetention(settings?.retention);
    return { retention };
}

export function getMessageRetention(message, fallback = DEFAULT_CHAT_RETENTION) {
    if (hasChatRetention(message?.retention)) {
        return cleanChatRetention(message.retention);
    }
    return cleanChatRetention(fallback);
}

export function withMessageRetention(message, retention = DEFAULT_CHAT_RETENTION) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return message;
    }
    const nextRetention = getMessageRetention(message, retention);
    return message.retention === nextRetention ? message : { ...message, retention: nextRetention };
}

export function ttlMillis(value) {
    return timestampMs(value, null, { positive: true });
}

export function isTtlExpired(value, now = Date.now()) {
    const ms = ttlMillis(value);
    return ms != null && ms <= now;
}

export function newMessageTtlMs(retention = DEFAULT_CHAT_RETENTION, now = Date.now()) {
    switch (cleanChatRetention(retention)) {
        case CHAT_RETENTION_SEEN:
        case CHAT_RETENTION_24H:
        default:
            return now + DEFAULT_MESSAGE_TTL_MS;
    }
}

export function seenMessageTtlMs(now = Date.now()) {
    return now + SEEN_MESSAGE_TTL_MS;
}

export function onSeenMessageTtlMs(now = Date.now()) {
    return now;
}
