import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { randomBytes } from 'node:crypto';
import { db, FieldValue, OK } from '../lib/admin.js';
import { HOUR_MS, MINUTE_MS, limitCallable, uidLimitKey } from '../lib/ratelimit.js';
import { loggedCall } from '../lib/actionlog.js';

const LINK_ID_RE = /^[0-9a-f]{64}$/i;
const CHAT_ID_RE = /^[0-9a-f]{64}$/i;

function cleanLinkId(value) {
    const linkId = typeof value === 'string' ? value.trim() : '';
    if (!LINK_ID_RE.test(linkId)) {
        throw new HttpsError('invalid-argument', 'bad link');
    }
    return linkId.toLowerCase();
}

function cleanChatId(value) {
    const chatId = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return CHAT_ID_RE.test(chatId) ? chatId : '';
}

function cleanVersion(value) {
    return Number.isInteger(value) && value > 0 ? value : 0;
}

function makeChatId() {
    return randomBytes(32).toString('hex');
}

export const openChatLink = onCall(loggedCall('openChatLink', async (context) => {
    const uid = context.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }
    await limitCallable(context, [
        { name: 'open-chat-link-uid-minute', key: uidLimitKey(uid, 'open-chat-link'), limit: 180, windowMs: MINUTE_MS },
        { name: 'open-chat-link-uid-hour', key: uidLimitKey(uid, 'open-chat-link'), limit: 1800, windowMs: HOUR_MS },
    ]);

    const linkId = cleanLinkId(context.data?.linkId);
    const linkRef = db.collection('links').doc(linkId);

    const chat = await db.runTransaction(async (tx) => {
        const linkSnap = await tx.get(linkRef);
        const current = linkSnap.data()?.chat || {};
        const activeId = cleanChatId(current.id);
        const version = cleanVersion(current.version);

        if (activeId) {
            const chatSnap = await tx.get(db.collection('chats').doc(activeId));
            if (!chatSnap.data()?.deleted) {
                return { id: activeId, version, exists: true };
            }
        }

        const next = {
            id: makeChatId(),
            version: version + 1,
        };
        tx.set(
            linkRef,
            {
                chat: {
                    id: next.id,
                    version: next.version,
                    ts: FieldValue.serverTimestamp(),
                },
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
        return { ...next, exists: false };
    });

    return { ...OK, linkId, chat };
}));
