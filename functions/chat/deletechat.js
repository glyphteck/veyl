import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, OK } from '../lib/admin.js';
import { HOUR_MS, limitCallable, uidLimitKey } from '../lib/ratelimit.js';
import { loggedCall } from '../lib/actionlog.js';

const CHAT_ID_RE = /^[0-9a-f]{64}$/i;
const ENTRY_ID_RE = /^[0-9a-f]{32}$/i;
const SAVED_DELETE_BATCH_SIZE = 400;

function cleanChatId(value) {
    const chatId = typeof value === 'string' ? value.trim() : '';
    if (!CHAT_ID_RE.test(chatId)) {
        throw new HttpsError('invalid-argument', 'bad chat');
    }
    return chatId.toLowerCase();
}

function cleanEntryId(value) {
    const entryId = typeof value === 'string' ? value.trim() : '';
    if (!entryId) {
        return '';
    }
    if (!ENTRY_ID_RE.test(entryId)) {
        throw new HttpsError('invalid-argument', 'bad chat entry');
    }
    return entryId.toLowerCase();
}

async function deleteOwnerSavedMessages(uid, chatId) {
    const snap = await db.collection('users').doc(uid).collection('savedMessages').where('chatId', '==', chatId).get();
    const docs = snap.docs || [];
    for (let index = 0; index < docs.length; index += SAVED_DELETE_BATCH_SIZE) {
        const batch = db.batch();
        docs.slice(index, index + SAVED_DELETE_BATCH_SIZE).forEach((docSnap) => batch.delete(docSnap.ref));
        await batch.commit();
    }
    return docs.length;
}

export const deleteChat = onCall(loggedCall('deleteChat', async (context) => {
    const uid = context.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }
    await limitCallable(context, {
        name: 'delete-chat-uid-hour',
        key: uidLimitKey(uid, 'delete-chat'),
        limit: 60,
        windowMs: HOUR_MS,
    });

    const chatId = cleanChatId(context.data?.chatId);
    const entryId = cleanEntryId(context.data?.entryId);
    const userRef = db.collection('users').doc(uid);

    if (entryId) {
        await userRef.collection('chats').doc(entryId).delete().catch(() => {});
    }
    await deleteOwnerSavedMessages(uid, chatId);
    await db.recursiveDelete(db.collection('chats').doc(chatId));

    return OK;
}));
