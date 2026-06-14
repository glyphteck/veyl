import { db } from './admin.js';

export async function ensureUserDoc(uid) {
    if (!uid) {
        throw new Error('uid required');
    }

    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();
    if (snap.exists) {
        return false;
    }

    await ref.set({});
    return true;
}
