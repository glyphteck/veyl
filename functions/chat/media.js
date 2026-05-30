import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import admin, { db, FieldValue, OK } from '../lib/admin.js';

const MEDIA_PATH_RE = /^media\/[0-9a-fA-F]{32}\/main$/;
const MEDIA_STAY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const MEDIA_STAY_KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;

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
    const stayId = cleanMediaStay(data?.stayId);
    const stayKey = cleanMediaStayKey(data?.stayKey);
    if (data?.saved === false) {
        await dropMediaStay(path, stayId, stayKey);
    } else {
        await saveMediaStay(path, stayId, stayKey);
    }
    return OK;
});
