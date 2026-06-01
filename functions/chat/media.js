import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import admin, { db, FieldValue, OK, Timestamp } from '../lib/admin.js';
import { HOUR_MS, MINUTE_MS, limitCallable, uidLimitKey } from '../lib/ratelimit.js';
import { CHAT_MEDIA_CONTENT_TYPE, CHAT_MEDIA_MAX_FILE_BYTES, CHAT_MEDIA_UPLOAD_RESERVATION_TTL_MS, chatMediaReserveLimitRules } from '../lib/abuseconfig.js';
import { assertQuotaRoom, cleanQuotaAmount, writeQuotaReservation } from '../lib/usagequota.js';
import { makeAccountUploadQuota } from '../lib/uploadquota.js';

const MEDIA_PATH_RE = /^media\/[0-9a-fA-F]{32}\/main$/;
const MEDIA_STAY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const MEDIA_STAY_KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
const MEDIA_UPLOAD_RESERVATIONS = 'media_upload_reservations';

function cleanMediaPath(value) {
    const path = typeof value === 'string' ? value.trim() : '';
    if (!MEDIA_PATH_RE.test(path)) {
        throw new HttpsError('invalid-argument', 'invalid media path');
    }
    return path;
}

function mediaIdFromPath(path) {
    return path.split('/')[1];
}

function cleanMediaStay(value) {
    const stayId = typeof value === 'string' ? value.trim() : '';
    if (!MEDIA_STAY_RE.test(stayId)) {
        throw new HttpsError('invalid-argument', 'invalid media stay');
    }
    return stayId;
}

function cleanMediaStayKey(value) {
    const stayKey = typeof value === 'string' ? value.trim() : '';
    if (!MEDIA_STAY_KEY_RE.test(stayKey)) {
        throw new HttpsError('invalid-argument', 'invalid media stay key');
    }
    return stayKey;
}

function mediaDocRef(mediaId) {
    return db.collection('mediaStays').doc(mediaId);
}

function mediaStayRef(mediaId, stayId) {
    return mediaDocRef(mediaId).collection('stays').doc(stayId);
}

function mediaUploadReservationRef(mediaId) {
    return db.collection(MEDIA_UPLOAD_RESERVATIONS).doc(mediaId);
}

function cleanMediaContentType(value) {
    const contentType = typeof value === 'string' ? value.trim().toLowerCase() : CHAT_MEDIA_CONTENT_TYPE;
    if (contentType !== CHAT_MEDIA_CONTENT_TYPE) {
        throw new HttpsError('invalid-argument', 'invalid media content type');
    }
    return contentType;
}

function cleanMediaUploadSize(value) {
    const size = cleanQuotaAmount(value);
    if (size > CHAT_MEDIA_MAX_FILE_BYTES) {
        throw new HttpsError('resource-exhausted', 'file too large', {
            limit: CHAT_MEDIA_MAX_FILE_BYTES,
            requested: size,
        });
    }
    return size;
}

function cleanStayCount(value) {
    return Number.isInteger(value) && value > 0 ? value : 0;
}

function stayKeyHash(path, stayId, stayKey) {
    return createHash('sha256').update(`${path}\n${stayId}\n${stayKey}`).digest('base64url');
}

function requireStayKeyMatch(staySnap, keyHash) {
    if (staySnap.data()?.keyHash !== keyHash) {
        throw new HttpsError('permission-denied', 'media stay key');
    }
}

async function setTemporaryHold(path, hold, { ignoreMissing = false } = {}) {
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

async function setMediaStay(path, stayId, stayKey, saved) {
    const mediaId = mediaIdFromPath(path);
    const mediaRef = mediaDocRef(mediaId);
    const stayRef = mediaStayRef(mediaId, stayId);
    const keyHash = stayKeyHash(path, stayId, stayKey);

    return db.runTransaction(async (tx) => {
        const [mediaSnap, staySnap] = await Promise.all([tx.get(mediaRef), tx.get(stayRef)]);
        const count = cleanStayCount(mediaSnap.data()?.stayCount);
        const exists = staySnap.exists;

        if (saved) {
            if (exists) {
                requireStayKeyMatch(staySnap, keyHash);
                return { hold: null, stayCount: count };
            }

            const stayCount = count + 1;
            tx.set(stayRef, { keyHash, updatedAt: FieldValue.serverTimestamp() });
            tx.set(mediaRef, { stayCount, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            return { hold: count === 0 ? true : null, stayCount };
        }

        if (!exists) {
            return { hold: null, stayCount: count };
        }
        requireStayKeyMatch(staySnap, keyHash);

        const stayCount = Math.max(0, count - 1);
        tx.delete(stayRef);
        if (stayCount > 0) {
            tx.set(mediaRef, { stayCount }, { merge: true });
        } else {
            tx.delete(mediaRef);
        }
        return { hold: stayCount === 0 ? false : null, stayCount };
    });
}

async function rollbackSavedMediaStay(path, stayId, stayKey) {
    await setMediaStay(path, stayId, stayKey, false).catch(() => {});
}

async function saveMediaStay(path, stayId, stayKey) {
    const update = await setMediaStay(path, stayId, stayKey, true);
    if (update.hold === true) {
        await setTemporaryHold(path, true).catch(async (error) => {
            await rollbackSavedMediaStay(path, stayId, stayKey);
            throw error;
        });
    }
    return update;
}

async function dropMediaStay(path, stayId, stayKey) {
    const update = await setMediaStay(path, stayId, stayKey, false);
    if (update.hold === false) {
        await setTemporaryHold(path, false, { ignoreMissing: true });
    }
    return update;
}

async function requireSignedInMediaRequest(auth, data) {
    if (!auth?.uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }

    const path = cleanMediaPath(data?.path);
    return path;
}

export const setMediaSaved = onCall(async ({ auth, data }) => {
    const path = await requireSignedInMediaRequest(auth, data);
    await limitCallable({ auth }, [
        { name: 'set-media-saved-uid-minute', key: uidLimitKey(auth.uid, 'set-media-saved'), limit: 90, windowMs: MINUTE_MS },
        { name: 'set-media-saved-uid-hour', key: uidLimitKey(auth.uid, 'set-media-saved'), limit: 600, windowMs: HOUR_MS },
    ]);
    const stayId = cleanMediaStay(data?.stayId);
    const stayKey = cleanMediaStayKey(data?.stayKey);
    if (data?.saved === false) {
        await dropMediaStay(path, stayId, stayKey);
    } else {
        await saveMediaStay(path, stayId, stayKey);
    }
    return OK;
});

export const reserveChatMediaUpload = onCall(async (context) => {
    const { auth, data } = context;
    if (!auth?.uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }

    await limitCallable(context, chatMediaReserveLimitRules(uidLimitKey(auth.uid, 'reserve-chat-media')));

    const path = cleanMediaPath(data?.path);
    const mediaId = mediaIdFromPath(path);
    const size = cleanMediaUploadSize(data?.size);
    const contentType = cleanMediaContentType(data?.contentType);
    const nowMs = Date.now();
    const { quota, dailyLimit, newAccount } = await makeAccountUploadQuota(auth.uid, nowMs);
    const reservationRef = mediaUploadReservationRef(mediaId);
    const expiresAtMs = nowMs + CHAT_MEDIA_UPLOAD_RESERVATION_TTL_MS;

    await db.runTransaction(async (tx) => {
        const [reservationSnap, quotaSnap] = await Promise.all([tx.get(reservationRef), tx.get(quota.ref)]);
        if (reservationSnap.exists) {
            throw new HttpsError('already-exists', 'media reservation exists');
        }
        assertQuotaRoom(quota, quotaSnap, size, nowMs);
        tx.create(reservationRef, {
            uid: auth.uid,
            path,
            size,
            contentType,
            createdAt: Timestamp.fromMillis(nowMs),
            ttl: Timestamp.fromMillis(expiresAtMs),
        });
        writeQuotaReservation(tx, quota, quotaSnap, size, nowMs);
    });

    return {
        path,
        mediaId,
        size,
        contentType,
        expiresAt: expiresAtMs,
        dailyLimit,
        newAccount,
    };
});
