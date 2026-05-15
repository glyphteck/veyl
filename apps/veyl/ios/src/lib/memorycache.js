let cachedUser = null;
const avatarCache = new Map();

export function getCachedUser() {
    return cachedUser;
}

export function setCachedUser(user) {
    cachedUser = user;
}

export function clearCachedUser() {
    cachedUser = null;
}

export function getCachedAvatar(uid) {
    if (!uid) return null;
    return avatarCache.get(uid) || null;
}

export function setCachedAvatar(uid, url) {
    if (!uid || !url) return;
    avatarCache.set(uid, url);
}

export function clearCachedAvatar(uid) {
    if (!uid) return;
    avatarCache.delete(uid);
}

export function clearAvatarCache() {
    avatarCache.clear();
}
