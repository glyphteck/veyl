export const MAX_USERNAME = 12;

const usernameKeyRegex = /^[a-z0-9]$/i;
const usernameStripRegex = /[^a-z0-9]/g;
export const usernameRegex = new RegExp(`^[a-z0-9]{1,${MAX_USERNAME}}$`);

export function normalizeUsername(value = '') {
    return String(value).trim().toLowerCase();
}

export function cleanUsername(value = '') {
    return normalizeUsername(value).replace(usernameStripRegex, '').slice(0, MAX_USERNAME);
}

export function isUsername(value = '') {
    return usernameRegex.test(value);
}

export function isUsernameKey(value = '') {
    return usernameKeyRegex.test(value);
}
