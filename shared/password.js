export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 64;
export const rules = [
    `Use ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`,
    'Most visible letters, numbers, symbols, emoji, and spaces are allowed.',
    'Spaces work inside the password, but not at the beginning or end.',
    'Tabs, newlines, and other invisible or control characters are not allowed.',
];

const controlCharRegex = /\p{C}/u;
const edgeWhitespaceRegex = /^\s|\s$/u;

export function normalizePassword(value = '') {
    return String(value ?? '').normalize('NFC');
}

export function getPasswordError(value = '') {
    const password = normalizePassword(value);

    if (!password) {
        return 'required';
    }
    if (edgeWhitespaceRegex.test(password)) {
        return 'edgewhitespace';
    }
    if (controlCharRegex.test(password)) {
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

export function isPassword(value = '') {
    return !getPasswordError(value);
}
