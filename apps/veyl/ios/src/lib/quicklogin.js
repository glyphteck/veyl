import { userAvatarCache } from '@/lib/useravatarcache';

const quickLoginListeners = new Set();
let pendingQuickLoginUid = null;

export function requestQuickLogin(uid) {
    if (!uid) return;
    pendingQuickLoginUid = uid;
    quickLoginListeners.forEach((listener) => {
        try {
            pendingQuickLoginUid = null;
            listener(uid);
        } catch (err) {
            console.warn('quick login listener failed', err);
        }
    });
}

export function subscribeQuickLoginRequest(listener) {
    if (typeof listener !== 'function') return () => {};
    quickLoginListeners.add(listener);
    if (pendingQuickLoginUid) {
        const uid = pendingQuickLoginUid;
        pendingQuickLoginUid = null;
        setTimeout(() => listener(uid), 0);
    }
    return () => {
        quickLoginListeners.delete(listener);
    };
}

export async function listQuickLoginAccounts() {
    const accounts = (await userAvatarCache.listRemembered?.().catch(() => [])) || [];
    return accounts;
}

export async function hasQuickLoginAccount(uid) {
    if (!uid) return false;
    return (await userAvatarCache.hasRemembered?.(uid).catch(() => false)) === true;
}

export async function touchQuickLoginAccount(uid) {
    if (!uid) return;
    await userAvatarCache.touchLogin?.(uid);
}

export async function forgetQuickLoginAccount(uid) {
    if (!uid) return;
    await userAvatarCache.forget?.(uid);
}
