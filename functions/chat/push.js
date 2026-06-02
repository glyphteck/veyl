import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { HOUR_MS, limitCallable, uidLimitKey } from '../lib/ratelimit.js';
import { cleanPing, sendPush } from '../lib/inbox.js';
import { pushSecrets } from '../lib/push.js';
import { loggedCall } from '../lib/actionlog.js';

const PUSH_PINGS_PER_HOUR = 1200;

function cleanRecipientUid(value) {
    const uid = typeof value === 'string' ? value.trim() : '';
    if (!uid || uid.includes('/') || uid.length > 128) {
        throw new HttpsError('invalid-argument', 'bad recipient');
    }
    return uid;
}

export const push = onCall({ secrets: pushSecrets }, loggedCall('push', async (context) => {
    const senderUid = context.auth?.uid;
    if (!senderUid) {
        throw new HttpsError('unauthenticated', 'auth');
    }

    const recipientUid = cleanRecipientUid(context.data?.recipientUid);
    const ping = cleanPing(context.data?.ping);
    await limitCallable(context, {
        name: 'push-ping-uid-hour',
        key: uidLimitKey(senderUid, 'push-ping'),
        limit: PUSH_PINGS_PER_HOUR,
        windowMs: HOUR_MS,
    });

    const result = await sendPush({ senderUid, recipientUid, ping });
    return { success: true, ...result };
}));
