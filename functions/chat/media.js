import { onCall, HttpsError } from 'firebase-functions/v2/https';
import admin, { db, OK } from '../lib/admin.js';

const MEDIA_PATH_RE = /^media\/[0-9a-fA-F]{32}\/main$/;
const MEDIA_STAY_RE = /^[A-Za-z0-9_-]{8,80}$/;

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

function mediaDocRef(mediaId) {
    return db.collection('mediaStays').doc(mediaId);
}

function mediaStayRef(mediaId, stayId) {
    return mediaDocRef(mediaId).collection('stays').doc(stayId);
}

function cleanStayCount(value) {
    return Number.isInteger(value) && value > 0 ? value : 0;
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

async function setMediaStay(mediaId, stayId, saved) {
    const mediaRef = mediaDocRef(mediaId);
    const stayRef = mediaStayRef(mediaId, stayId);

    return db.runTransaction(async (tx) => {
        const [mediaSnap, staySnap] = await Promise.all([tx.get(mediaRef), tx.get(stayRef)]);
        const count = cleanStayCount(mediaSnap.data()?.stayCount);
        const exists = staySnap.exists;

        if (saved) {
            if (exists) {
                return { hold: null, stayCount: count };
            }

            const stayCount = count + 1;
            tx.set(stayRef, {});
            tx.set(mediaRef, { stayCount }, { merge: true });
            return { hold: count === 0 ? true : null, stayCount };
        }

        if (!exists) {
            return { hold: null, stayCount: count };
        }

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

async function rollbackSavedMediaStay(mediaId, stayId) {
    await setMediaStay(mediaId, stayId, false).catch(() => {});
}

async function saveMediaStay(path, stayId) {
    const mediaId = mediaIdFromPath(path);
    const update = await setMediaStay(mediaId, stayId, true);
    if (update.hold === true) {
        await setTemporaryHold(path, true).catch(async (error) => {
            await rollbackSavedMediaStay(mediaId, stayId);
            throw error;
        });
    }
    return update;
}

async function dropMediaStay(path, stayId) {
    const mediaId = mediaIdFromPath(path);
    const update = await setMediaStay(mediaId, stayId, false);
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
    if (data?.saved === false) {
        await dropMediaStay(path, stayId);
    } else {
        await saveMediaStay(path, stayId);
    }
    return OK;
});
