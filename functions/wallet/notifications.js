import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { FieldValue, OK, db, projectId } from '../lib/admin.js';
import { sendPushToUid } from '../lib/push.js';

const REGION = 'us-central1';
const WALLET_NETWORKS = new Set(['MAINNET', 'REGTEST', 'TESTNET', 'SIGNET', 'LOCAL']);
const WALLET_PK_RE = /^0[2-3][0-9a-f]{64}$/i;
const EVENT_TYPES = [
    'SPARK_STATIC_DEPOSIT_FINISHED',
    'SPARK_LIGHTNING_RECEIVE_FINISHED',
    'SPARK_LIGHTNING_SEND_FINISHED',
    'SPARK_COOP_EXIT_FINISHED',
];
const SECRET_HEADERS = ['x-spark-webhook-secret', 'x-spark-secret', 'spark-secret', 'x-webhook-secret'];
const SIGNATURE_HEADERS = ['x-spark-webhook-signature', 'x-spark-signature', 'x-webhook-signature', 'x-signature'];

function normalizeNetwork(value) {
    const next = String(value ?? '').trim().toUpperCase();
    if (!WALLET_NETWORKS.has(next)) {
        throw new HttpsError('invalid-argument', 'Invalid wallet network.');
    }
    return next;
}

function normalizeWalletPK(value) {
    const walletPK = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!WALLET_PK_RE.test(walletPK)) {
        throw new HttpsError('invalid-argument', 'Invalid wallet public key.');
    }
    return walletPK;
}

function routeIdFor(network, walletPK) {
    return createHash('sha256').update(`${network}:${walletPK}`).digest('hex');
}

function hashValue(value) {
    return createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes = 24) {
    return randomBytes(bytes).toString('base64url');
}

function randomWebhookSecret() {
    return randomBytes(12).toString('base64url').slice(0, 16);
}

function webhookBaseUrl() {
    const override = process.env.SPARK_WALLET_WEBHOOK_URL?.trim();
    if (override) {
        return override.replace(/[?&]+$/, '');
    }
    return `https://${REGION}-${projectId}.cloudfunctions.net/sparkWalletWebhook`;
}

function webhookUrl(routeId, routeToken) {
    const url = new URL(webhookBaseUrl());
    url.searchParams.set('r', routeId);
    url.searchParams.set('t', routeToken);
    return url.toString();
}

async function assertWalletOwner(uid, network, walletPK) {
    const snap = await db.collection('profiles').doc(uid).get();
    const walletPKs = snap.data()?.walletPKs;
    const existing = walletPKs && typeof walletPKs === 'object' && typeof walletPKs[network] === 'string' ? walletPKs[network].trim().toLowerCase() : '';
    if (existing !== walletPK) {
        throw new HttpsError('permission-denied', 'Wallet does not belong to this account.');
    }
}

function safeEqualString(a, b) {
    const left = Buffer.from(String(a ?? ''));
    const right = Buffer.from(String(b ?? ''));
    return left.length === right.length && timingSafeEqual(left, right);
}

function headerValue(req, name) {
    const value = req.get(name);
    return typeof value === 'string' ? value.trim() : '';
}

function rawBody(req) {
    if (Buffer.isBuffer(req.rawBody)) {
        return req.rawBody;
    }
    if (typeof req.rawBody === 'string') {
        return Buffer.from(req.rawBody);
    }
    return Buffer.from(JSON.stringify(req.body ?? {}));
}

function parsedBody(req) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        return req.body;
    }
    try {
        return JSON.parse(rawBody(req).toString('utf8'));
    } catch {
        return {};
    }
}

function signatureMatches(signature, bodyBytes, secret) {
    if (!signature) {
        return false;
    }

    const normalized = signature.trim().replace(/^sha256=/i, '');
    const expectedHex = createHmac('sha256', secret).update(bodyBytes).digest('hex');
    if (safeEqualString(normalized, expectedHex)) {
        return true;
    }

    const expectedBase64 = createHmac('sha256', secret).update(bodyBytes).digest('base64');
    return safeEqualString(normalized, expectedBase64);
}

function requestHasValidSecret(req, body, secret) {
    if (!secret) {
        return false;
    }

    for (const header of SECRET_HEADERS) {
        if (safeEqualString(headerValue(req, header), secret)) {
            return true;
        }
    }

    const authorization = headerValue(req, 'authorization').replace(/^bearer\s+/i, '');
    if (safeEqualString(authorization, secret)) {
        return true;
    }

    if (safeEqualString(body?.secret, secret)) {
        return true;
    }

    const bytes = rawBody(req);
    return SIGNATURE_HEADERS.some((header) => signatureMatches(headerValue(req, header), bytes, secret));
}

function readQueryString(req, key) {
    const value = req.query?.[key];
    if (Array.isArray(value)) {
        return typeof value[0] === 'string' ? value[0] : '';
    }
    return typeof value === 'string' ? value : '';
}

function readEventType(body) {
    const value = body?.event_type ?? body?.eventType ?? body?.type ?? body?.event?.type;
    const eventType = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return eventType || 'SPARK_WALLET_EVENT';
}

function readEventId(body) {
    const value = body?.event_id ?? body?.eventId ?? body?.id ?? body?.event?.id;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function walletPushBody(eventType) {
    return {
        title: 'veyl',
        body: eventType === 'SPARK_STATIC_DEPOSIT_FINISHED' ? 'deposit ready' : 'wallet activity',
        data: {
            type: 'wallet',
        },
    };
}

export const prepareWalletNotifications = onCall(async ({ auth, data }) => {
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'auth');

    const uid = auth.uid;
    const network = normalizeNetwork(data?.network);
    const walletPK = normalizeWalletPK(data?.walletPK);
    await assertWalletOwner(uid, network, walletPK);

    const routeId = routeIdFor(network, walletPK);
    const routeRef = db.collection('walletWebhookRoutes').doc(routeId);
    const routeSnap = await routeRef.get();
    const route = routeSnap.exists ? routeSnap.data() : {};
    const routeToken = typeof route?.routeToken === 'string' && route.routeToken.length >= 16 ? route.routeToken : randomToken();
    const secret = typeof route?.secret === 'string' && route.secret.length === 16 ? route.secret : randomWebhookSecret();
    const url = webhookUrl(routeId, routeToken);

    await routeRef.set(
        {
            uid,
            network,
            walletPK,
            routeToken,
            secret,
            url,
            eventTypes: EVENT_TYPES,
            enabled: true,
            preparedAt: route?.preparedAt || FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    return {
        routeId,
        url,
        secret,
        eventTypes: EVENT_TYPES,
    };
});

export const confirmWalletNotifications = onCall(async ({ auth, data }) => {
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'auth');

    const uid = auth.uid;
    const network = normalizeNetwork(data?.network);
    const walletPK = normalizeWalletPK(data?.walletPK);
    await assertWalletOwner(uid, network, walletPK);

    const routeId = routeIdFor(network, walletPK);
    const routeRef = db.collection('walletWebhookRoutes').doc(routeId);
    const routeSnap = await routeRef.get();
    if (!routeSnap.exists || routeSnap.data()?.uid !== uid) {
        throw new HttpsError('failed-precondition', 'Wallet notification route is not prepared.');
    }

    const webhookId = typeof data?.webhookId === 'string' && data.webhookId.trim() ? data.webhookId.trim() : null;
    await routeRef.set(
        {
            webhookId,
            registeredAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            registrationFailures: FieldValue.delete(),
            lastRegistrationError: FieldValue.delete(),
        },
        { merge: true }
    );
    await db.collection('users').doc(uid).set(
        {
            walletNotifications: {
                [network]: {
                    registered: true,
                    routeId,
                    webhookId,
                    updatedAt: FieldValue.serverTimestamp(),
                },
            },
        },
        { merge: true }
    );

    return OK;
});

export const sparkWalletWebhook = onRequest(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'method not allowed' });
        return;
    }

    const routeId = readQueryString(req, 'r');
    const routeToken = readQueryString(req, 't');
    if (!/^[0-9a-f]{64}$/i.test(routeId) || !routeToken) {
        res.status(404).json({ error: 'not found' });
        return;
    }

    const routeRef = db.collection('walletWebhookRoutes').doc(routeId);
    const routeSnap = await routeRef.get();
    const route = routeSnap.exists ? routeSnap.data() : null;
    if (!route?.enabled || !safeEqualString(route.routeToken, routeToken)) {
        res.status(404).json({ error: 'not found' });
        return;
    }

    const body = parsedBody(req);
    if (!requestHasValidSecret(req, body, route.secret)) {
        await routeRef.set(
            {
                failedVerificationCount: FieldValue.increment(1),
                lastFailedVerificationAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
        res.status(403).json({ error: 'forbidden' });
        return;
    }

    const eventType = readEventType(body);
    const eventId = readEventId(body);
    const payloadHash = hashValue(rawBody(req));
    const eventDocId = hashValue(eventId ? `${routeId}:${eventId}` : `${routeId}:${eventType}:${payloadHash}`);
    const eventRef = db.collection('walletWebhookEvents').doc(eventDocId);
    let duplicate = false;

    try {
        await eventRef.create({
            routeId,
            uid: route.uid,
            network: route.network,
            eventType,
            eventId,
            payloadHash,
            receivedAt: FieldValue.serverTimestamp(),
            source: 'spark',
        });
    } catch (error) {
        if (error?.code === 6 || error?.code === 'already-exists' || error?.code === 'ALREADY_EXISTS') {
            duplicate = true;
            const existing = await eventRef.get();
            if (existing.data()?.pushedAt) {
                res.status(200).json({ ok: true, duplicate: true });
                return;
            }
        } else {
            throw error;
        }
    }

    let pushSent;
    try {
        const result = await sendPushToUid(route.uid, walletPushBody(eventType));
        pushSent = result.sent;
    } catch (error) {
        await eventRef.set(
            {
                pushError: error?.message || String(error),
                pushFailedAt: FieldValue.serverTimestamp(),
                pushAttempts: FieldValue.increment(1),
            },
            { merge: true }
        );
        throw error;
    }

    await Promise.all([
        eventRef.set(
            {
                pushSent,
                pushedAt: FieldValue.serverTimestamp(),
                duplicate,
                pushAttempts: FieldValue.increment(1),
            },
            { merge: true }
        ),
        routeRef.set(
            {
                lastWebhookAt: FieldValue.serverTimestamp(),
                lastEventType: eventType,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        ),
    ]);

    res.status(200).json({ ok: true });
});
