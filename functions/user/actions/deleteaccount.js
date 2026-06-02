import { onCall, HttpsError } from 'firebase-functions/v2/https';
import admin, { db, OK } from '../../lib/admin.js';
import { DAY_MS, limitCallable, uidLimitKey } from '../../lib/ratelimit.js';
import { loggedCall } from '../../lib/actionlog.js';

export const deleteAccount = onCall(loggedCall('deleteAccount', async (context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'auth');
    const uid = context.auth.uid;
    await limitCallable(context, {
        name: 'delete-account-uid-day',
        key: uidLimitKey(uid, 'delete-account'),
        limit: 3,
        windowMs: DAY_MS,
    });
    const bucket = admin.storage().bucket();

    await db.recursiveDelete(db.collection('users').doc(uid));

    // delete avatar
    await bucket.file(`${uid}/avatar.webp`).delete({ ignoreNotFound: true });

    // then delete user data
    const batch = db.batch();
    batch.delete(db.collection('seeds').doc(uid));
    batch.delete(db.collection('profiles').doc(uid));
    batch.delete(db.collection('moderation').doc(uid));
    const unameSnap = await db.collection('usernames').where('uid', '==', uid).get();
    unameSnap.forEach((d) => batch.delete(d.ref));
    const pks = await db.collection('passkeys').where('uid', '==', uid).get();
    pks.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    // delete user
    await admin.auth().deleteUser(uid);
    return OK;
}));
