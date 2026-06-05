import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import admin, { db } from '../lib/admin.js';
import { HOUR_MS, MINUTE_MS, ipLimitKey, limitCallable, uidLimitKey } from '../lib/ratelimit.js';
import { MEDIA_CONTENT_TYPE, MEDIA_UPLOAD_URL_TTL_MS, mediaUploadLimitRules } from '../lib/abuseconfig.js';
import { assertQuotaRoom, cleanQuotaAmount, writeQuotaReservation } from '../lib/usagequota.js';
import { makeAccountUploadQuota } from '../lib/uploadquota.js';
import { loggedCall } from '../lib/actionlog.js';

const CHAT_ID_RE = /^[0-9a-f]{64}$/i;
const CHAT_MEDIA_ID_RE = /^[0-9a-f]{32}$/i;
const SHARED_MEDIA_ID_RE = /^[0-9a-f]{32}$/i;
const CHAT_MEDIA_PATH_RE = /^chats\/([0-9a-f]{64})\/([0-9a-f]{32})$/i;

export function cleanChatMediaChatId(value) {
    const chatId = typeof value === 'string' ? value.trim() : '';
    if (!CHAT_ID_RE.test(chatId)) {
        throw new HttpsError('invalid-argument', 'bad chat');
    }
    return chatId.toLowerCase();
}

export function cleanChatMediaId(value) {
    const mediaId = typeof value === 'string' ? value.trim() : '';
    if (!CHAT_MEDIA_ID_RE.test(mediaId)) {
        throw new HttpsError('invalid-argument', 'bad chat media');
    }
    return mediaId.toLowerCase();
}

function cleanSharedMediaId(value) {
    const sharedId = typeof value === 'string' ? value.trim() : '';
    if (!SHARED_MEDIA_ID_RE.test(sharedId)) {
        throw new HttpsError('invalid-argument', 'bad shared media');
    }
    return sharedId.toLowerCase();
}

export function chatMediaPath(chatId, mediaId) {
    return `chats/${cleanChatMediaChatId(chatId)}/${cleanChatMediaId(mediaId)}`;
}

function cleanChatMediaPath(value) {
    const path = typeof value === 'string' ? value.trim() : '';
    const match = path.match(CHAT_MEDIA_PATH_RE);
    if (!match?.[1] || !match?.[2]) {
        throw new HttpsError('invalid-argument', 'bad chat media path');
    }
    return chatMediaPath(match[1], match[2]);
}

export function sharedMediaPath(sharedId) {
    return `shared/${cleanSharedMediaId(sharedId)}`;
}

function cleanMediaContentType(value) {
    const contentType = typeof value === 'string' ? value.trim().toLowerCase() : MEDIA_CONTENT_TYPE;
    if (contentType !== MEDIA_CONTENT_TYPE) {
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

function httpErrorStatus(error) {
    switch (error?.code) {
        case 'invalid-argument':
            return 400;
        case 'not-found':
            return 404;
        case 'resource-exhausted':
            return 429;
        case 'failed-precondition':
            return 412;
        default:
            return 500;
    }
}

function httpErrorBody(error) {
    return {
        ok: false,
        code: error?.code || 'internal',
        message: error?.message || 'error',
    };
}

export const setChatMediaHold = onRequest({ cors: true }, async (req, res) => {
    try {
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }
        if (req.method !== 'POST') {
            res.status(405).json({ ok: false, code: 'method-not-allowed' });
            return;
        }

        await limitCallable({ rawRequest: req }, [
            { name: 'chat-hold-ip-minute', key: ipLimitKey({ rawRequest: req }, 'chat-hold'), limit: 180, windowMs: MINUTE_MS },
            { name: 'chat-hold-ip-hour', key: ipLimitKey({ rawRequest: req }, 'chat-hold'), limit: 1800, windowMs: HOUR_MS },
        ]);

        const path = cleanChatMediaPath(req.body?.path);
        if (req.body?.hold !== true && req.body?.hold !== false) {
            throw new HttpsError('invalid-argument', 'bad hold');
        }

        await setTemporaryHold(path, req.body.hold, { ignoreMissing: req.body.hold !== true });
        res.json({ ok: true });
    } catch (error) {
        res.status(httpErrorStatus(error)).json(httpErrorBody(error));
    }
});

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

export const reserveSharedMediaUpload = onCall(loggedCall('reserveSharedMediaUpload', async (context) => {
    const { auth, data } = context;
    if (!auth?.uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }

    await limitCallable(context, mediaUploadLimitRules(uidLimitKey(auth.uid, 'shared-media-upload')));

    const sharedId = cleanSharedMediaId(data?.sharedId);
    const path = sharedMediaPath(sharedId);
    if (data?.path !== path) {
        throw new HttpsError('invalid-argument', 'invalid shared media path');
    }

    const size = cleanMediaUploadSize(data?.size);
    const contentType = cleanMediaContentType(data?.contentType);
    const nowMs = Date.now();
    const { quota, dailyLimit, newAccount } = await makeAccountUploadQuota(auth.uid, nowMs);
    const expiresAtMs = nowMs + MEDIA_UPLOAD_URL_TTL_MS;

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
