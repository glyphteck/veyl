import { cloud } from '@/lib/cloud';
import { dropPush } from '@/lib/push';
import { userAvatarCache } from '@/lib/user/avatarcache';

async function saveRememberChoice(uid, remember, account = null) {
    if (!uid || remember == null) {
        return;
    }
    try {
        if (remember) {
            await userAvatarCache.remember?.(uid, account);
        } else {
            await userAvatarCache.forget?.(uid);
        }
    } catch (error) {
        console.warn('failed to update remembered account', error);
    }
}

export async function logout({ remember = null, account = null, lock = null } = {}) {
    const uid = cloud.auth.user?.uid;
    await saveRememberChoice(uid, remember, account);
    lock?.();
    await dropPush({ uid }).catch(() => {});
    await cloud.auth.logout();
}
