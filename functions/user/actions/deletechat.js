import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, OK } from '../../lib/admin.js';
import { HOUR_MS, limitCallable, uidLimitKey } from '../../lib/ratelimit.js';

export const deleteChat = onCall(async (context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'auth');
    const uid = context.auth.uid;
    await limitCallable(context, {
        name: 'delete-chat-uid-hour',
        key: uidLimitKey(uid, 'delete-chat'),
        limit: 20,
        windowMs: HOUR_MS,
    });

    const chatId = context.data?.chatId;
    if (!chatId || typeof chatId !== 'string') throw new HttpsError('invalid-argument', 'chatId required');

    const profileSnap = await db.collection('profiles').doc(uid).get();
    const chatPK = profileSnap.exists ? (profileSnap.data()?.chatPK ?? null) : null;

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

    // Keep media blobs in Storage. Shared attachment messages can reference
    // these immutable objects from other chats after this chat is deleted.
    await db.recursiveDelete(chatRef);

    return OK;
});
