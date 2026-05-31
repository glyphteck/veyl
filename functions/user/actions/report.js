import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, Timestamp, OK } from '../../lib/admin.js';
import { DAY_MS, HOUR_MS, limitCallable, uidLimitKey } from '../../lib/ratelimit.js';

const MAX_CONTENT = 4000;
const MAX_PATH = 500;
const MAX_NOTE = 1000;
const REPORT_TYPES = new Set(['txt', 'req', 'img', 'file', 'mp3', 'mp4']);
const FILE_REPORT_TYPES = new Set(['img', 'file', 'mp3', 'mp4']);
const UID_RE = /^[^/]{1,128}$/;
const REPORT_PATH_RE = /^reports\/([^/]{1,128})\/([^/]{1,128})\/([A-Za-z0-9_-]{8,80})$/;

function cleanUid(value) {
    const uid = typeof value === 'string' ? value.trim() : '';
    if (!UID_RE.test(uid)) {
        throw new HttpsError('invalid-argument', 'bad uid');
    }
    return uid;
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

function cleanPath(value, reporterUid, targetUid) {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new HttpsError('invalid-argument', 'bad path');
    }

    const path = value.trim();
    const match = path.match(REPORT_PATH_RE);
    if (!path || path.length > MAX_PATH || match?.[1] !== reporterUid || match?.[2] !== targetUid) {
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
    if (targetUid === uid) throw new HttpsError('invalid-argument', 'cannot report self');
    await limitCallable({ auth }, [
        { name: 'submit-report-uid-hour', key: uidLimitKey(uid, 'submit-report'), limit: 5, windowMs: HOUR_MS },
        { name: 'submit-report-uid-day', key: uidLimitKey(uid, 'submit-report'), limit: 20, windowMs: DAY_MS },
    ]);

    const type = cleanType(data?.type);
    const content = cleanContent(data?.content);
    const path = cleanPath(data?.path, uid, targetUid);
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
