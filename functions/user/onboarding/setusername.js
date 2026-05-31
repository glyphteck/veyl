import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, OK } from '../../lib/admin.js';
import { DAY_MS, HOUR_MS, limitCallable, uidLimitKey } from '../../lib/ratelimit.js';
import { isUsername, normalizeUsername } from '../../lib/regex.js';
import { syncPushRouteForUid } from '../../lib/pushroute.js';
import { usernames } from '../../lib/usernames.js';

function usernameError(reason) {
    return new HttpsError('invalid-argument', 'username unavailable', { reason });
}

function usernameStatus(username) {
    if (!isUsername(username)) {
        return 'invalid';
    }
    if (usernames.reserved.has(username)) {
        return 'reserved';
    }
    if (usernames.banned.exact.has(username) || usernames.banned.contains.some((part) => username.includes(part))) {
        return 'banned';
    }
    return 'ok';
}

export const setUsername = onCall(async (context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'auth');
    await limitCallable(context, [
        { name: 'set-username-uid-hour', key: uidLimitKey(context.auth.uid, 'set-username'), limit: 20, windowMs: HOUR_MS },
        { name: 'set-username-uid-day', key: uidLimitKey(context.auth.uid, 'set-username'), limit: 60, windowMs: DAY_MS },
    ]);
    const username = normalizeUsername(context.data?.username || '');
    const status = usernameStatus(username);
    if (status !== 'ok') throw usernameError(status);

    await db.runTransaction(async (t) => {
        const unameRef = db.collection('usernames').doc(username);
        if ((await t.get(unameRef)).exists) throw new HttpsError('already-exists', 'username unavailable', { reason: 'taken' });
        t.set(unameRef, { uid: context.auth.uid });
        t.set(db.collection('profiles').doc(context.auth.uid), { username }, { merge: true });
    });
    await syncPushRouteForUid(context.auth.uid);
    return OK;
});
