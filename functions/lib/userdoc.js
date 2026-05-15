import { db } from './admin.js';

const defaultSettings = {
    glass: true,
    moneyFormat: 'usd',
    sendOnScan: false,
    confirmSend: false,
    faceID: null,
    autolock: {
        timer: 'never',
        onHide: false,
        onBlur: false,
        onBackground: false,
    },
};

export async function ensureUserDoc(uid) {
    if (!uid) {
        throw new Error('uid required');
    }

    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();
    if (snap.exists) {
        return false;
    }

    await ref.set({ settings: defaultSettings });
    return true;
}
