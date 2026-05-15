export const MAX_USERNAME = 12;

export const usernameRegex = new RegExp(`^[a-z0-9]{1,${MAX_USERNAME}}$`);

export function normalizeUsername(value = '') {
    return String(value).trim().toLowerCase();
}

export function isUsername(value = '') {
    return usernameRegex.test(value);
}
