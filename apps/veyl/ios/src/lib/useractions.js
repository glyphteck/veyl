import { signOut } from 'firebase/auth';

import { auth } from '@/lib/firebase';
import { dropPush } from '@/lib/push';
import { userAvatarCache } from '@/lib/useravatarcache';

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
    const uid = auth.currentUser?.uid;
    await saveRememberChoice(uid, remember, account);
    lock?.();
    await dropPush({ uid }).catch(() => {});
    await signOut(auth);
}
