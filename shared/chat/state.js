import { randomBytes, toHex } from '../crypto/core.js';

export function makeCid() {
    return `${Date.now().toString(36)}${toHex(randomBytes(3))}`;
}

export function getMessageKey(message) {
    return message?.cid || message?.id || null;
}

function getCidMs(cid) {
    if (typeof cid !== 'string' || cid.length <= 6) {
        return null;
    }

    const base = cid.slice(0, -6);
    const ms = Number.parseInt(base, 36);
    return Number.isFinite(ms) ? ms : null;
}

export function getMessageOrderMs(message) {
    return getCidMs(message?.cid) ?? (typeof message?.ts?.toMillis === 'function' ? message.ts.toMillis() : Infinity);
}

export function sortMessages(messages) {
    return [...messages].sort((a, b) => {
        const aMs = getMessageOrderMs(a);
        const bMs = getMessageOrderMs(b);
        if (aMs !== bMs) {
            return aMs - bMs;
        }
        return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
}

export function mergeMessages(...groups) {
    const merged = new Map();

    for (const group of groups) {
        for (const message of group || []) {
            const key = getMessageKey(message);
            if (!key) {
                continue;
            }
            merged.set(key, message);
        }
    }

    return sortMessages([...merged.values()]);
}
