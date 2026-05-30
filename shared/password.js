import { PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS } from './config.js';

export const MIN_PASSWORD = PASSWORD_MIN_CHARS;
export const MAX_PASSWORD = PASSWORD_MAX_CHARS;
export const rules = [
    `Use ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`,
    'Most visible letters, numbers, symbols, and emoji are allowed.',
    'Spaces are allowed, but tabs, newlines, and other invisible or control characters are not.',
];

const controlCharRegex = /\p{C}/u;

export function normalizePassword(value = '') {
    return String(value ?? '').normalize('NFC');
}

function hasControlChars(value = '') {
    return controlCharRegex.test(normalizePassword(value));
}

export function getPasswordError(value = '') {
    const password = normalizePassword(value);

    if (!password) {
        return 'required';
    }
    if (hasControlChars(password)) {
        return 'controlchars';
    }
    if (password.length < MIN_PASSWORD) {
        return 'tooshort';
    }
    if (password.length > MAX_PASSWORD) {
        return 'toolong';
    }

    return '';
}

export function getPasswordFeedback(value = '') {
    const password = normalizePassword(value);

    if (!password) {
        return { error: 'required', status: 'idle' };
    }

    if (hasControlChars(password)) {
        return { error: 'controlchars', status: 'invalid' };
    }

    const error = getPasswordError(password);

    if (!error || error === 'required') {
        return { error, status: error ? 'idle' : 'valid' };
    }

    if (error === 'tooshort') {
        return { error, status: 'short' };
    }

    return { error, status: 'invalid' };
}

export function isPassword(value = '') {
    return !getPasswordError(value);
}
