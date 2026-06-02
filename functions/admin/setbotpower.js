import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { OK } from '../lib/admin.js';
import { isAdminUid, setBotPowerState } from '../lib/bots.js';
import { HOUR_MS, limitCallable, uidLimitKey } from '../lib/ratelimit.js';
import { loggedCall } from '../lib/actionlog.js';

export const setBotPower = onCall(loggedCall('setBotPower', async ({ auth, data }) => {
    if (!auth?.uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }
    if (!(await isAdminUid(auth.uid))) {
        throw new HttpsError('permission-denied', 'admin');
    }
    await limitCallable({ auth }, {
        name: 'set-bot-power-uid-hour',
        key: uidLimitKey(auth.uid, 'set-bot-power'),
        limit: 120,
        windowMs: HOUR_MS,
    });

    if (typeof data?.enabled !== 'boolean') {
        throw new HttpsError('invalid-argument', 'enabled must be boolean');
    }

    try {
        await setBotPowerState(data?.botId, data.enabled);
        return OK;
    } catch (error) {
        if (error?.message === 'bot not found') {
            throw new HttpsError('not-found', 'bot not found');
        }
        throw error;
    }
}));
