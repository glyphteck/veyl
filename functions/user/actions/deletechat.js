import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { OK } from '../../lib/admin.js';
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

    return OK;
});
