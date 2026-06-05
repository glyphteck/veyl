import { onCall, HttpsError } from 'firebase-functions/v2/https';
import admin, { db } from '../lib/admin.js';
import { limitCallable, uidLimitKey } from '../lib/ratelimit.js';
import { CHAT_MEDIA_CONTENT_TYPE, CHAT_MEDIA_UPLOAD_URL_TTL_MS, chatMediaUploadLimitRules } from '../lib/abuseconfig.js';
import { assertQuotaRoom, cleanQuotaAmount, writeQuotaReservation } from '../lib/usagequota.js';
import { makeAccountUploadQuota } from '../lib/uploadquota.js';
import { loggedCall } from '../lib/actionlog.js';

const CHAT_ID_RE = /^[0-9a-f]{64}$/i;
const MESSAGE_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SHARED_MEDIA_ID_RE = /^[0-9a-f]{32}$/i;

export function cleanChatMediaChatId(value) {
    const chatId = typeof value === 'string' ? value.trim() : '';
    if (!CHAT_ID_RE.test(chatId)) {
        throw new HttpsError('invalid-argument', 'bad chat');
    }
    return chatId.toLowerCase();
}

export function cleanChatMediaMessageKey(value) {
    const messageKey = typeof value === 'string' ? value.trim() : '';
    if (!MESSAGE_KEY_RE.test(messageKey)) {
        throw new HttpsError('invalid-argument', 'bad media message');
    }
    return messageKey;
}

function cleanSharedMediaId(value) {
    const sharedId = typeof value === 'string' ? value.trim() : '';
    if (!SHARED_MEDIA_ID_RE.test(sharedId)) {
        throw new HttpsError('invalid-argument', 'bad shared media');
    }
    return sharedId.toLowerCase();
}

export function chatMediaPath(chatId, messageKey) {
    return `chat-media/${cleanChatMediaChatId(chatId)}/${cleanChatMediaMessageKey(messageKey)}/main`;
}

export function sharedMediaPath(sharedId) {
    return `shared/${cleanSharedMediaId(sharedId)}`;
}

function chatDocRef(chatId) {
    return db.collection('chats').doc(chatId);
}

function cleanMediaContentType(value) {
    const contentType = typeof value === 'string' ? value.trim().toLowerCase() : CHAT_MEDIA_CONTENT_TYPE;
    if (contentType !== CHAT_MEDIA_CONTENT_TYPE) {
        throw new HttpsError('invalid-argument', 'invalid media content type');
    }
    return contentType;
}

function cleanMediaUploadSize(value) {
    return cleanQuotaAmount(value);
}

export async function setTemporaryHold(path, hold, { ignoreMissing = false } = {}) {
    const file = admin.storage().bucket().file(path);
    await file.setMetadata({ temporaryHold: hold }).catch((error) => {
        if (error?.code === 404 || error?.errors?.some?.((item) => item?.reason === 'notFound')) {
            if (ignoreMissing) {
                return;
            }
            throw new HttpsError('not-found', 'media not found');
        }
        throw error;
    });
}

async function signUpload(path, contentType, expiresAtMs) {
    const [url] = await admin.storage().bucket().file(path).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiresAtMs,
        contentType,
    });
    return {
        url,
        method: 'PUT',
        headers: {
            'Content-Type': contentType,
        },
        expiresAt: expiresAtMs,
    };
}

export const reserveChatMediaUpload = onCall(loggedCall('reserveChatMediaUpload', async (context) => {
    const { auth, data } = context;
    if (!auth?.uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }

    await limitCallable(context, chatMediaUploadLimitRules(uidLimitKey(auth.uid, 'chat-media-upload')));

    const chatId = cleanChatMediaChatId(data?.chatId);
    const messageKey = cleanChatMediaMessageKey(data?.messageKey);
    const path = chatMediaPath(chatId, messageKey);
    if (data?.path !== path) {
        throw new HttpsError('invalid-argument', 'invalid media path');
    }

    const size = cleanMediaUploadSize(data?.size);
    const contentType = cleanMediaContentType(data?.contentType);
    const nowMs = Date.now();
    const { quota, dailyLimit, newAccount } = await makeAccountUploadQuota(auth.uid, nowMs);
    const expiresAtMs = nowMs + CHAT_MEDIA_UPLOAD_URL_TTL_MS;

    await db.runTransaction(async (tx) => {
        const [quotaSnap, chatSnap] = await Promise.all([tx.get(quota.ref), tx.get(chatDocRef(chatId))]);
        if (chatSnap.data()?.deleted) {
            throw new HttpsError('failed-precondition', 'chat deleted');
        }
        assertQuotaRoom(quota, quotaSnap, size, nowMs);
        writeQuotaReservation(tx, quota, quotaSnap, size, nowMs);
    });

    const upload = await signUpload(path, contentType, expiresAtMs);
    return {
        path,
        chatId,
        messageKey,
        size,
        contentType,
        upload,
        expiresAt: upload.expiresAt,
        dailyLimit,
        newAccount,
    };
}));

export const reserveSharedMediaUpload = onCall(loggedCall('reserveSharedMediaUpload', async (context) => {
    const { auth, data } = context;
    if (!auth?.uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }

    await limitCallable(context, chatMediaUploadLimitRules(uidLimitKey(auth.uid, 'shared-media-upload')));

    const sharedId = cleanSharedMediaId(data?.sharedId);
    const path = sharedMediaPath(sharedId);
    if (data?.path !== path) {
        throw new HttpsError('invalid-argument', 'invalid shared media path');
    }

    const size = cleanMediaUploadSize(data?.size);
    const contentType = cleanMediaContentType(data?.contentType);
    const nowMs = Date.now();
    const { quota, dailyLimit, newAccount } = await makeAccountUploadQuota(auth.uid, nowMs);
    const expiresAtMs = nowMs + CHAT_MEDIA_UPLOAD_URL_TTL_MS;

    await db.runTransaction(async (tx) => {
        const quotaSnap = await tx.get(quota.ref);
        assertQuotaRoom(quota, quotaSnap, size, nowMs);
        writeQuotaReservation(tx, quota, quotaSnap, size, nowMs);
    });

    const upload = await signUpload(path, contentType, expiresAtMs);
    return {
        path,
        sharedId,
        size,
        contentType,
        upload,
        expiresAt: upload.expiresAt,
        dailyLimit,
        newAccount,
    };
}));
