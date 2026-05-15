import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { OK } from '../lib/admin.js';
import { isAdminUid, setBotPowerState } from '../lib/bots.js';

export const setBotPower = onCall(async ({ auth, data }) => {
    if (!auth?.uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }
    if (!(await isAdminUid(auth.uid))) {
        throw new HttpsError('permission-denied', 'admin');
    }

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
});
