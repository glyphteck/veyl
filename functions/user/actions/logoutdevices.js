import { onCall, HttpsError } from 'firebase-functions/v2/https';
import admin, { OK } from '../../lib/admin.js';
import { HOUR_MS, limitCallable, uidLimitKey } from '../../lib/ratelimit.js';
import { loggedCall } from '../../lib/actionlog.js';

export const logoutDevices = onCall(loggedCall('logoutDevices', async (context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'auth');
    const uid = context.auth.uid;
    await limitCallable(context, {
        name: 'logout-devices-uid-hour',
        key: uidLimitKey(uid, 'logout-devices'),
        limit: 10,
        windowMs: HOUR_MS,
    });
    await admin.auth().revokeRefreshTokens(uid);
    return OK;
}));
