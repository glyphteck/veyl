import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, Timestamp, OK } from '../../lib/admin.js';

const MAX_CONTENT = 4000;
const MAX_PATH = 500;
const MAX_NOTE = 1000;
const REPORT_TYPES = new Set(['txt', 'req', 'img', 'file', 'mp3', 'mp4']);
const FILE_REPORT_TYPES = new Set(['img', 'file', 'mp3', 'mp4']);

function cleanUid(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function cleanType(value) {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new HttpsError('invalid-argument', 'bad type');
    }

    const type = value.trim();
    if (!REPORT_TYPES.has(type)) {
        throw new HttpsError('invalid-argument', 'bad type');
    }

    return type;
}

function cleanContent(value) {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new HttpsError('invalid-argument', 'bad content');
    }

    const content = value.trim();
    if (!content || content.length > MAX_CONTENT) {
        throw new HttpsError('invalid-argument', 'bad content');
    }

    return content;
}

function cleanPath(value) {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new HttpsError('invalid-argument', 'bad path');
    }

    const path = value.trim();
    if (!path || path.length > MAX_PATH) {
        throw new HttpsError('invalid-argument', 'bad path');
    }

    return path;
}

function cleanNote(value) {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new HttpsError('invalid-argument', 'bad note');
    }

    const note = value.trim();
    if (!note || note.length > MAX_NOTE) {
        throw new HttpsError('invalid-argument', 'bad note');
    }

    return note;
}

export const submitReport = onCall(async ({ auth, data }) => {
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'auth');

    const uid = auth.uid;
    const targetUid = cleanUid(data?.uid);
    if (!targetUid) throw new HttpsError('invalid-argument', 'uid required');
    if (targetUid === uid) throw new HttpsError('invalid-argument', 'cannot report self');

    const type = cleanType(data?.type);
    const content = cleanContent(data?.content);
    const path = cleanPath(data?.path);
    const note = cleanNote(data?.note);

    if (!type && (content || path)) {
        throw new HttpsError('invalid-argument', 'bad evidence');
    }

    if (content && type !== 'txt') {
        throw new HttpsError('invalid-argument', 'bad content');
    }

    if (path && !FILE_REPORT_TYPES.has(type)) {
        throw new HttpsError('invalid-argument', 'bad path');
    }

    if (type && FILE_REPORT_TYPES.has(type) && !path) {
        throw new HttpsError('invalid-argument', 'bad path');
    }

    const profileSnap = await db.collection('profiles').doc(targetUid).get();
    if (!profileSnap.exists) throw new HttpsError('not-found', 'user');

    const now = Timestamp.now();
    const reportedRef = db.collection('reported').doc(targetUid);
    const reportRef = reportedRef.collection('reports').doc();
    const report = {
        reporter: uid,
        createdAt: now,
    };

    if (type) {
        report.type = type;
    }

    if (content) {
        report.content = content;
    }

    if (path) {
        report.path = path;
    }

    if (note) {
        report.note = note;
    }

    const batch = db.batch();
    batch.set(reportRef, report);
    batch.set(
        reportedRef,
        {
            count: FieldValue.increment(1),
            lastReportAt: now,
        },
        { merge: true }
    );
    await batch.commit();

    return OK;
});
