import { getMessageKey, getMessageOrderMs } from './state.js';

export function keySet(value) {
    if (value instanceof Set) {
        return value;
    }
    return new Set(Array.isArray(value) ? value.filter(Boolean) : []);
}

export function messageKeys(message) {
    if (typeof message === 'string') {
        const key = message.trim();
        return key ? [key] : [];
    }
    return [...new Set([getMessageKey(message), message?.id, message?.cid].map((key) => (typeof key === 'string' ? key.trim() : '')).filter(Boolean))];
}

export function addMessageKeys(keys, message) {
    if (!keys || !message) {
        return;
    }

    for (const key of messageKeys(message)) {
        keys.add(key);
    }
}

export function messageHasKey(message, keys) {
    if (!message || !keys?.size) {
        return false;
    }

    return messageKeys(message).some((key) => keys.has(key));
}

export function collectMessageKeys(messages) {
    const keys = new Set();
    for (const message of Array.isArray(messages) ? messages : [messages]) {
        addMessageKeys(keys, message);
    }
    return keys;
}

export function indexMessagesByKey(messages, { keep = 'first' } = {}) {
    const byKey = new Map();
    const replace = keep === 'last';
    for (const message of messages || []) {
        for (const key of messageKeys(message)) {
            if (key && (replace || !byKey.has(key))) {
                byKey.set(key, message);
            }
        }
    }
    return byKey;
}

export function targetMessageMs(target, byKey) {
    const key = typeof target === 'string' ? target.trim() : '';
    if (!key) {
        return null;
    }
    const message = byKey?.get?.(key);
    const ms = getMessageOrderMs(message ?? { cid: key });
    return Number.isFinite(ms) ? ms : null;
}
