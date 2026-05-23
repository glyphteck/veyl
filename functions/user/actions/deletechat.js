import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, OK } from '../../lib/admin.js';

function chunk(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

export const deleteChat = onCall(async (context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'auth');
    const uid = context.auth.uid;

    const chatId = context.data?.chatId;
    if (!chatId || typeof chatId !== 'string') throw new HttpsError('invalid-argument', 'chatId required');

    const profileSnap = await db.collection('profiles').doc(uid).get();
    let chatPK = profileSnap.exists ? (profileSnap.data()?.chatPK ?? null) : null;

    if (!chatPK) {
        const keySnap = await db.collection('chatkeys').where('uid', '==', uid).limit(1).get();
        chatPK = keySnap.empty ? null : keySnap.docs[0].id;
    }

    if (!chatPK) throw new HttpsError('permission-denied', 'cannot verify participation');

    const chatRef = db.collection('chats').doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) return OK; // already gone

    const participants = chatSnap.data()?.participants ?? [];
    if (!participants.includes(chatPK)) throw new HttpsError('permission-denied', 'not a participant');

    await chatRef.set(
        {
            participants,
            deleting: true,
            lastMsg: FieldValue.delete(),
        },
        { merge: true }
    );

    const msgSnap = await chatRef.collection('messages').get();
    const staleDocs = msgSnap.docs;

    for (const docs of chunk(staleDocs, 400)) {
        const batch = db.batch();
        for (const docSnap of docs) {
            batch.delete(docSnap.ref);
        }
        await batch.commit();
    }

    // Keep media blobs in Storage. Shared attachment messages can reference
    // these immutable objects from other chats after this chat is deleted.

    await chatRef.delete();

    return OK;
});
