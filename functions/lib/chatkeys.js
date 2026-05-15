import { FieldValue, db } from './admin.js';

export async function getUidByChatPK(chatPK) {
    if (!chatPK) {
        return null;
    }

    const keyRef = db.collection('chatkeys').doc(chatPK);
    const keySnap = await keyRef.get();
    const cachedUid = keySnap.data()?.uid;

    if (cachedUid) {
        return cachedUid;
    }

    const profileSnap = await db.collection('profiles').where('chatPK', '==', chatPK).limit(1).get();
    const uid = profileSnap.docs[0]?.id ?? null;

    if (uid) {
        await keyRef.set(
            {
                uid,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    }

    return uid;
}
