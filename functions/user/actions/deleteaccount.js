import { onCall, HttpsError } from 'firebase-functions/v2/https';
import admin, { db, OK } from '../../lib/admin.js';
import { DAY_MS, limitCallable, uidLimitKey } from '../../lib/ratelimit.js';

export const deleteAccount = onCall(async (context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'auth');
    const uid = context.auth.uid;
    await limitCallable(context, {
        name: 'delete-account-uid-day',
        key: uidLimitKey(uid, 'delete-account'),
        limit: 3,
        windowMs: DAY_MS,
    });
    const bucket = admin.storage().bucket();

    // delete user chats
    const profileSnap = await db.collection('profiles').doc(uid).get();
    const profileData = profileSnap.exists ? profileSnap.data() : null;
    if (profileData?.chatPK) {
        const chatPK = profileData.chatPK;
        const chats = await db.collection('chats').where('participants', 'array-contains', chatPK).get();
        for (const doc of chats.docs) {
            // Chat media can be referenced by forwarded attachment messages in
            // other chats, so account deletion leaves Storage blobs intact.
            await db.recursiveDelete(doc.ref);
        }
    }

    await db.recursiveDelete(db.collection('users').doc(uid));
    const walletEvents = await db.collection('walletWebhookEvents').where('uid', '==', uid).get();
    await Promise.all(walletEvents.docs.map((d) => d.ref.delete()));

    // delete avatar
    await bucket.file(`${uid}/avatar.webp`).delete({ ignoreNotFound: true });

    // then delete user data
    const batch = db.batch();
    batch.delete(db.collection('seeds').doc(uid));
    batch.delete(db.collection('profiles').doc(uid));
    batch.delete(db.collection('moderation').doc(uid));
    if (profileData?.chatPK) {
        batch.delete(db.collection('pushRoutes').doc(profileData.chatPK));
    }
    const unameSnap = await db.collection('usernames').where('uid', '==', uid).get();
    unameSnap.forEach((d) => batch.delete(d.ref));
    const pks = await db.collection('passkeys').where('uid', '==', uid).get();
    pks.forEach((d) => batch.delete(d.ref));
    const walletRoutes = await db.collection('walletWebhookRoutes').where('uid', '==', uid).get();
    walletRoutes.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    // delete user
    await admin.auth().deleteUser(uid);
    return OK;
});
