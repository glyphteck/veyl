import { HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp } from './admin.js';
import { getPushDocs, sendPush as notifyPush } from './push.js';
import { isChatBanned } from './moderation.js';
import { DAY_MS } from './ratelimit.js';

const UID_RE = /^[^/]{1,128}$/;
const PING_BODY_MAX_BYTES = 64 * 1024;
const INBOX_PING_TTL_MS = 21 * DAY_MS;
const INBOX = 'inbox';
const VERBOSE = typeof process !== 'undefined' && process.env?.VEYL_VERBOSE === '1';

function safeLogId(value) {
    const text = cleanString(value);
    return text ? `${text.slice(0, 8)}:${text.length}` : null;
}

function inboxLog(op, fields = {}) {
    if (VERBOSE) {
        console.log('[inbox]', op, fields);
    }
}

function cleanUid(value, message = 'bad uid') {
    const uid = typeof value === 'string' ? value.trim() : '';
    if (!UID_RE.test(uid)) {
        throw new HttpsError('invalid-argument', message);
    }
    return uid;
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function cleanBase64Body(value) {
    const body = cleanString(value);
    if (!body || body.length > Math.ceil((PING_BODY_MAX_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
        throw new HttpsError('invalid-argument', 'bad ping body');
    }
    const bytes = Buffer.from(body, 'base64');
    if (!bytes.length || bytes.length > PING_BODY_MAX_BYTES) {
        throw new HttpsError('invalid-argument', 'bad ping body');
    }
    return bytes;
}

export function cleanPing(value) {
    const v = Math.floor(Number(value?.v));
    const epk = cleanString(value?.epk);
    if (!Number.isInteger(v) || v < 1 || v > 10) {
        throw new HttpsError('invalid-argument', 'bad ping version');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(epk)) {
        throw new HttpsError('invalid-argument', 'bad ping key');
    }
    return {
        v,
        epk,
        body: cleanBase64Body(value?.body),
    };
}

function notificationTitle(profile) {
    const username = cleanString(profile?.username);
    return username ? `@${username}` : 'New message';
}

function timestampMs(value) {
    const ms = typeof value?.toMillis === 'function' ? value.toMillis() : Number(value);
    return Number.isFinite(ms) ? ms : Date.now();
}

async function profile(uid) {
    inboxLog('read profile', { uid: safeLogId(uid) });
    const snap = await db.collection('profiles').doc(uid).get();
    inboxLog('read profile done', { uid: safeLogId(uid), hit: snap.exists });
    return snap.exists ? { uid: snap.id, ...snap.data() } : null;
}

export async function sendPush({ senderUid, recipientUid, ping, now = Timestamp.now(), sendNotification = true }) {
    const sender = cleanUid(senderUid, 'bad sender uid');
    const recipient = cleanUid(recipientUid, 'bad recipient uid');
    if (sender === recipient) {
        throw new HttpsError('invalid-argument', 'cannot push self');
    }

    inboxLog('read push checks', { senderUid: safeLogId(sender), recipientUid: safeLogId(recipient) });
    const [senderProfile, recipientProfile, senderBanned, blockedSnap] = await Promise.all([
        profile(sender),
        profile(recipient),
        isChatBanned(sender),
        db.collection('users').doc(recipient).collection('blocked').doc(sender).get(),
    ]);
    inboxLog('read push checks done', {
        senderUid: safeLogId(sender),
        recipientUid: safeLogId(recipient),
        senderProfile: Boolean(senderProfile),
        recipientProfile: Boolean(recipientProfile),
        senderBanned,
        blocked: blockedSnap.exists,
    });
    if (!senderProfile) {
        throw new HttpsError('failed-precondition', 'sender profile missing');
    }
    if (!recipientProfile) {
        throw new HttpsError('not-found', 'recipient');
    }
    if (senderBanned) {
        throw new HttpsError('permission-denied', 'chat unavailable');
    }
    if (blockedSnap.exists) {
        throw new HttpsError('permission-denied', 'blocked');
    }

    const nowMs = timestampMs(now);
    const pingRef = db.collection('users').doc(recipient).collection(INBOX).doc();
    inboxLog('write ping', { senderUid: safeLogId(sender), recipientUid: safeLogId(recipient), pingId: safeLogId(pingRef.id) });
    await pingRef.create({
        ...ping,
        ts: Timestamp.fromMillis(nowMs),
        ttl: Timestamp.fromMillis(nowMs + INBOX_PING_TTL_MS),
    });

    if (!sendNotification) {
        return { pingId: pingRef.id, sent: 0 };
    }

    const pushDocs = await getPushDocs(recipient);
    inboxLog('read push routes done', { recipientUid: safeLogId(recipient), count: pushDocs.length });
    if (!pushDocs.length) {
        return { pingId: pingRef.id, sent: 0 };
    }

    inboxLog('send push notification', { recipientUid: safeLogId(recipient), count: pushDocs.length });
    await notifyPush(recipient, pushDocs, {
        collapseId: `chat-${recipient}`,
        title: notificationTitle(senderProfile),
        body: 'sent you a message',
        data: {
            type: 'chat',
        },
    });
    return { pingId: pingRef.id, sent: pushDocs.length };
}
