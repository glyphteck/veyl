import { getMessageKey } from './state.js';

export function keySet(value) {
    if (value instanceof Set) {
        return value;
    }
    return new Set(Array.isArray(value) ? value.filter(Boolean) : []);
}

export function addMessageKeys(keys, message) {
    if (!keys || !message) {
        return;
    }

    if (typeof message === 'string') {
        const key = message.trim();
        if (key) {
            keys.add(key);
        }
        return;
    }

    const key = getMessageKey(message);
    const id = typeof message.id === 'string' ? message.id.trim() : '';
    const cid = typeof message.cid === 'string' ? message.cid.trim() : '';
    if (key) {
        keys.add(key);
    }
    if (id) {
        keys.add(id);
    }
    if (cid) {
        keys.add(cid);
    }
}

export function messageHasKey(message, keys) {
    if (!message || !keys?.size) {
        return false;
    }

    const key = getMessageKey(message);
    const id = typeof message.id === 'string' ? message.id.trim() : '';
    const cid = typeof message.cid === 'string' ? message.cid.trim() : '';
    return !!((key && keys.has(key)) || (id && keys.has(id)) || (cid && keys.has(cid)));
}

export function collectMessageKeys(messages) {
    const keys = new Set();
    for (const message of Array.isArray(messages) ? messages : [messages]) {
        addMessageKeys(keys, message);
    }
    return keys;
}
