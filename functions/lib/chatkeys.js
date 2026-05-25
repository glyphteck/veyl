import { db } from './admin.js';

export async function getUidByChatPK(chatPK) {
    if (!chatPK) {
        return null;
    }

    const keyRef = db.collection('chatkeys').doc(chatPK);
    const keySnap = await keyRef.get();
    return keySnap.data()?.uid || null;
}
