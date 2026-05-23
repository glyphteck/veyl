'use client';

export const CHAT_RETENTION_SEEN = 'seen';
export const CHAT_RETENTION_24H = '24h';
export const DEFAULT_CHAT_RETENTION = CHAT_RETENTION_24H;
export const CHAT_RETENTION_VALUES = Object.freeze([CHAT_RETENTION_SEEN, CHAT_RETENTION_24H]);
export const CHAT_RETENTION_LABELS = Object.freeze({
    [CHAT_RETENTION_SEEN]: 'on seen',
    [CHAT_RETENTION_24H]: '24h after seen',
});

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MESSAGE_TTL_MS = 21 * DAY_MS;
export const SEEN_MESSAGE_TTL_MS = DAY_MS;

export function hasChatRetention(value) {
    const retention = typeof value === 'string' ? value.trim() : '';
    return CHAT_RETENTION_VALUES.includes(retention);
}

export function cleanChatRetention(value) {
    const retention = typeof value === 'string' ? value.trim() : '';
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
    if (value == null) {
        return null;
    }
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    const ms = Number(value);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
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

export function shouldShortenTtl(currentTtl, nextTtlMs) {
    if (!Number.isFinite(nextTtlMs) || nextTtlMs <= 0) {
        return false;
    }
    const currentMs = ttlMillis(currentTtl);
    return currentMs != null && currentMs > nextTtlMs;
}
