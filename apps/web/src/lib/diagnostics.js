'use client';

const ENABLED = process.env.NEXT_PUBLIC_VEYL_VERBOSE === '1';

const SAFE_STRING_KEYS = new Set([
    'code',
    'kind',
    'lockState',
    'phase',
    'reason',
    'route',
    'source',
    'stage',
    'state',
    'status',
    'type',
]);
const SENSITIVE_STRING_KEYS = new Set(['chatId', 'message', 'name', 'path', 'pathname', 'stack', 'to', 'uri']);

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return '"[unserializable]"';
    }
}

function redactValue(value, key = '') {
    if (value == null || typeof value === 'boolean' || typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        if (SAFE_STRING_KEYS.has(key)) {
            return value;
        }
        if (SENSITIVE_STRING_KEYS.has(key)) {
            return value ? '[redacted]' : '';
        }
        return value.length <= 24 && /^[a-z0-9_.:-]+$/i.test(value) ? value : '[redacted]';
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, key));
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
    }
    return '[redacted]';
}

export function mark(label, data) {
    if (!ENABLED) {
        return;
    }
    const payload = data == null ? '' : ` ${safeJson(redactValue(data))}`;
    console.log(`[diag] ${new Date().toISOString()} ${label}${payload}`);
}
