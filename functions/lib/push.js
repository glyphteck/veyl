import { FieldValue, db } from './admin.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) {
        out.push(list.slice(i, i + size));
    }
    return out;
}

export async function getPushDocs(uid) {
    const snap = await db.collection('users').doc(uid).collection('push').get();
    return snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((item) => item.enabled !== false && typeof item.token === 'string' && item.token);
}

async function markDead(uid, docs) {
    const validDocs = docs.filter((item) => item?.id);
    if (!uid || !validDocs.length) {
        return;
    }

    const batch = db.batch();
    validDocs.forEach((item) => {
        batch.set(
            db.collection('users').doc(uid).collection('push').doc(item.id),
            {
                enabled: false,
                lastError: 'DeviceNotRegistered',
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    });
    await batch.commit();
}

export async function sendPush(uid, docs, body) {
    const stale = [];

    for (const group of chunk(docs, CHUNK)) {
        const payload = group.map((item) => ({
            to: item.token,
            sound: 'default',
            title: body.title,
            body: body.body,
            data: body.data,
        }));

        const res = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'accept-encoding': 'gzip, deflate',
                'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`expo push failed (${res.status}): ${text}`);
        }

        const json = await res.json();
        if (Array.isArray(json?.errors) && json.errors.length) {
            throw new Error(`expo push request error: ${JSON.stringify(json.errors[0])}`);
        }
        const data = Array.isArray(json?.data) ? json.data : [];
        console.info('push expo tickets', {
            uid,
            sent: group.length,
            ok: data.filter((ticket) => ticket?.status === 'ok').length,
            errors: data.filter((ticket) => ticket?.status === 'error').map((ticket) => ticket?.details?.error || 'unknown'),
        });

        data.forEach((ticket, index) => {
            if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered' && group[index]) {
                stale.push(group[index]);
            }
        });
    }

    if (stale.length) {
        await markDead(uid, stale);
    }
}

export async function sendPushToUid(uid, body) {
    const docs = await getPushDocs(uid);
    if (!docs.length) {
        return { sent: 0 };
    }

    await sendPush(uid, docs, body);
    return { sent: docs.length };
}
