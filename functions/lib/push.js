import { FieldValue, db } from './admin.js';
import { createHash, createSign } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import http2 from 'node:http2';
import { syncPushRouteForUid } from './pushroute.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const APNS_PROD_HOST = 'api.push.apple.com';
const APNS_SANDBOX_HOST = 'api.sandbox.push.apple.com';
const CHUNK = 100;
const MAX_PUSH_DOCS_PER_USER = 4;
const APNS_KEY_ID = defineSecret('APNS_KEY_ID');
const APNS_TEAM_ID = defineSecret('APNS_TEAM_ID');
const APNS_PRIVATE_KEY_BASE64 = defineSecret('APNS_PRIVATE_KEY_BASE64');
let apnsJwt = null;

export const pushSecrets = [APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY_BASE64];

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) {
        out.push(list.slice(i, i + size));
    }
    return out;
}

export async function getPushDocs(uid) {
    const snap = await db.collection('users').doc(uid).collection('push').orderBy('updatedAt', 'desc').limit(MAX_PUSH_DOCS_PER_USER).get();
    return snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((item) => item.enabled !== false && ((typeof item.nativeToken === 'string' && item.nativeToken) || (typeof item.token === 'string' && item.token)));
}

async function markDead(uid, docs, lastError = 'DeviceNotRegistered') {
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
                lastError,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    });
    await batch.commit();
    await syncPushRouteForUid(uid).catch((error) => {
        console.warn('push route sync failed after dead token cleanup', {
            uid,
            error: error?.message || String(error),
        });
    });
}

function base64url(input) {
    return Buffer.from(input).toString('base64url');
}

function normalizeCollapseId(value) {
    const clean = typeof value === 'string' ? value.trim() : '';
    if (!clean) {
        return null;
    }
    if (Buffer.byteLength(clean) <= 64) {
        return clean;
    }
    return `v-${createHash('sha256').update(clean).digest('base64url')}`;
}

function secretValue(param) {
    try {
        return param.value();
    } catch {
        return '';
    }
}

function readApnsPrivateKey() {
    const encoded = secretValue(APNS_PRIVATE_KEY_BASE64) || process.env.APNS_PRIVATE_KEY_BASE64;
    const raw = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : process.env.APNS_PRIVATE_KEY;
    return typeof raw === 'string' ? raw.replace(/\\n/g, '\n').trim() : '';
}

function getApnsCredentials() {
    const keyId = (secretValue(APNS_KEY_ID) || process.env.APNS_KEY_ID || '').trim();
    const teamId = (secretValue(APNS_TEAM_ID) || process.env.APNS_TEAM_ID || '').trim();
    const privateKey = readApnsPrivateKey();
    return keyId && teamId && privateKey ? { keyId, privateKey, teamId } : null;
}

function apnsToken() {
    const credentials = getApnsCredentials();
    if (!credentials) {
        return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (apnsJwt && apnsJwt.expiresAt > now + 60) {
        return apnsJwt.token;
    }

    const head = base64url(JSON.stringify({ alg: 'ES256', kid: credentials.keyId }));
    const claims = base64url(JSON.stringify({ iss: credentials.teamId, iat: now }));
    const unsigned = `${head}.${claims}`;
    const sign = createSign('SHA256');
    sign.update(unsigned);
    sign.end();
    const signature = sign.sign({ key: credentials.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const token = `${unsigned}.${signature}`;
    apnsJwt = { expiresAt: now + 50 * 60, token };
    return token;
}

function apnsHost(environment) {
    return environment === 'production' ? APNS_PROD_HOST : APNS_SANDBOX_HOST;
}

function apnsPayload(body) {
    const data = body.data || {};
    return {
        aps: {
            alert: {
                title: body.title,
                body: body.body,
            },
            sound: 'default',
        },
        body: data,
        ...data,
    };
}

function sendApnsOne(client, token, item, body) {
    const collapseId = normalizeCollapseId(body.collapseId);
    return new Promise((resolve) => {
        const req = client.request({
            ':method': 'POST',
            ':path': `/3/device/${item.nativeToken}`,
            authorization: `bearer ${token}`,
            'apns-topic': item.apnsTopic,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            ...(collapseId ? { 'apns-collapse-id': collapseId } : {}),
        });
        let response = '';
        let status = 0;

        req.setEncoding('utf8');
        req.on('response', (headers) => {
            status = Number(headers[':status'] || 0);
        });
        req.on('data', (chunkValue) => {
            response += chunkValue;
        });
        req.on('error', (error) => {
            resolve({ item, ok: false, reason: error?.message || String(error), status: 0 });
        });
        req.on('end', () => {
            let reason = '';
            try {
                reason = JSON.parse(response)?.reason || '';
            } catch {}
            resolve({ item, ok: status >= 200 && status < 300, reason: reason || response || null, status });
        });
        req.end(JSON.stringify(apnsPayload(body)));
    });
}

async function sendApns(uid, docs, body) {
    if (!docs.length) {
        return { configured: Boolean(getApnsCredentials()), sent: 0 };
    }

    const token = apnsToken();
    if (!token) {
        console.warn('push apns skipped: credentials missing', { uid, devices: docs.length });
        return { configured: false, sent: 0 };
    }

    const stale = [];
    const groups = new Map();
    docs.forEach((item) => {
        const host = apnsHost(item.apnsEnvironment);
        groups.set(host, [...(groups.get(host) || []), item]);
    });
    let sent = 0;
    let ok = 0;
    const errors = [];

    for (const [host, group] of groups) {
        const client = http2.connect(`https://${host}`);
        try {
            const results = await Promise.all(group.map((item) => sendApnsOne(client, token, item, body)));
            sent += results.length;
            ok += results.filter((result) => result.ok).length;
            errors.push(...results.filter((result) => !result.ok).map((result) => result.reason || `status:${result.status}`));
            stale.push(...results.filter((result) => ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(result.reason)).map((result) => result.item));
        } finally {
            client.close();
        }
    }

    console.info('push apns results', {
        uid,
        sent,
        ok,
        errors,
    });

    if (stale.length) {
        await markDead(uid, stale, 'Unregistered');
    }

    return { configured: true, sent };
}

async function sendExpo(uid, docs, body) {
    const stale = [];
    const collapseId = normalizeCollapseId(body.collapseId);

    for (const group of chunk(docs, CHUNK)) {
        const payload = group.map((item) => ({
            to: item.token,
            sound: 'default',
            title: body.title,
            body: body.body,
            data: body.data,
            ...(collapseId ? { collapseId, tag: collapseId } : {}),
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

export async function sendPush(uid, docs, body) {
    const nativeDocs = docs.filter((item) => typeof item.nativeToken === 'string' && item.nativeToken && typeof item.apnsTopic === 'string' && item.apnsTopic);
    const expoDocs = docs.filter((item) => item.platform !== 'ios' && !nativeDocs.includes(item) && typeof item.token === 'string' && item.token);
    await sendApns(uid, nativeDocs, body);

    if (expoDocs.length) {
        await sendExpo(uid, expoDocs, body);
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
