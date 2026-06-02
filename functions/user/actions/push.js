import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { db, FieldValue, OK } from '../../lib/admin.js';
import { HOUR_MS, limitCallable, uidLimitKey } from '../../lib/ratelimit.js';
import { loggedCall } from '../../lib/actionlog.js';

const DID_RE = /^[a-zA-Z0-9_-]{12,128}$/;
const EXPO_RE = /^(Expo|Exponent)PushToken\[[^\]]+\]$/;
const APNS_TOKEN_RE = /^[0-9a-fA-F]{32,256}$/;
const PUSH_VARIANTS = new Set(['dev', 'test', 'prod']);
const PUSH_ENVIRONMENTS = new Set(['development', 'production']);
const APNS_TOPICS = new Set(['com.glyphteck.veyl.dev', 'com.glyphteck.veyl.test', 'com.glyphteck.veyl']);
const MAX_PUSH_DEVICES_PER_USER = 4;
const PUSH_DEVICE_OWNERS = 'push_device_owners';
const PUSH_TOKEN_OWNERS = 'push_token_owners';
const PUSH_OWNER_VERSION = 1;
const PUSH_NOOP_FIELDS = ['did', 'token', 'nativeToken', 'platform', 'provider', 'appVariant', 'apnsTopic', 'apnsEnvironment', 'enabled', 'ownerVersion'];
const PUSH_VARIANT_META = {
    dev: { apnsTopic: 'com.glyphteck.veyl.dev', apnsEnvironment: 'development' },
    test: { apnsTopic: 'com.glyphteck.veyl.test', apnsEnvironment: 'production' },
    prod: { apnsTopic: 'com.glyphteck.veyl', apnsEnvironment: 'production' },
};

async function limitPushAction(context, action) {
    const uid = context.auth?.uid;
    await limitCallable(context, {
        name: `${action}-push-uid-hour`,
        key: uidLimitKey(uid, action),
        limit: 120,
        windowMs: HOUR_MS,
    });
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value) {
    const str = cleanString(value);
    return str || null;
}

function requireDid(value) {
    const did = cleanString(value);
    if (!DID_RE.test(did)) {
        throw new HttpsError('invalid-argument', 'bad device id');
    }
    return did;
}

function optionalExpoToken(value) {
    const token = optionalString(value);
    if (token && !EXPO_RE.test(token)) {
        throw new HttpsError('invalid-argument', 'bad push token');
    }
    return token;
}

function optionalNativeToken(value) {
    const token = optionalString(value);
    if (token && !APNS_TOKEN_RE.test(token)) {
        throw new HttpsError('invalid-argument', 'bad native push token');
    }
    return token;
}

function requireMember(value, allowed, message) {
    const str = cleanString(value);
    if (!allowed.has(str)) {
        throw new HttpsError('invalid-argument', message);
    }
    return str;
}

function pushDoc(data) {
    const did = requireDid(data?.did);
    const token = optionalExpoToken(data?.token);
    const nativeToken = optionalNativeToken(data?.nativeToken);
    if (!token && !nativeToken) {
        throw new HttpsError('invalid-argument', 'push token required');
    }
    const appVariant = requireMember(data?.appVariant, PUSH_VARIANTS, 'bad app variant');
    const apnsTopic = requireMember(data?.apnsTopic, APNS_TOPICS, 'bad apns topic');
    const apnsEnvironment = requireMember(data?.apnsEnvironment, PUSH_ENVIRONMENTS, 'bad apns environment');
    const expectedMeta = PUSH_VARIANT_META[appVariant];
    if (expectedMeta.apnsTopic !== apnsTopic || expectedMeta.apnsEnvironment !== apnsEnvironment) {
        throw new HttpsError('invalid-argument', 'bad push environment');
    }

    return {
        did,
        token,
        nativeToken,
        platform: 'ios',
        provider: nativeToken ? 'apns' : 'expo',
        appVariant,
        apnsTopic,
        apnsEnvironment,
        ownerVersion: PUSH_OWNER_VERSION,
        enabled: true,
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function pushDocEquivalent(current, next) {
    if (!current || current.ownerVersion !== PUSH_OWNER_VERSION) {
        return false;
    }
    return PUSH_NOOP_FIELDS.every((field) => (current[field] ?? null) === (next[field] ?? null));
}

function ownerKey(kind, value) {
    return createHash('sha256').update(`${kind}\n${value}`).digest('base64url');
}

function pushRef(uid, did) {
    return db.collection('users').doc(uid).collection('push').doc(did);
}

function didOwnerRef(did) {
    return db.collection(PUSH_DEVICE_OWNERS).doc(ownerKey('did', did));
}

function tokenOwnerEntries(data) {
    const entries = [];
    const nativeToken = cleanString(data?.nativeToken);
    const token = cleanString(data?.token);
    if (APNS_TOKEN_RE.test(nativeToken)) {
        entries.push({
            kind: 'apns',
            ref: db.collection(PUSH_TOKEN_OWNERS).doc(ownerKey('apns', nativeToken)),
        });
    }
    if (EXPO_RE.test(token)) {
        entries.push({
            kind: 'expo',
            ref: db.collection(PUSH_TOKEN_OWNERS).doc(ownerKey('expo', token)),
        });
    }
    return entries;
}

function ownerData(uid, did, path, kind = null) {
    return {
        uid,
        did,
        path,
        ...(kind ? { kind } : {}),
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function refFromOwner(owner) {
    const uid = cleanString(owner?.uid);
    const did = cleanString(owner?.did);
    if (!uid || !DID_RE.test(did)) {
        return null;
    }
    return pushRef(uid, did);
}

function addStaleOwnerRef(refs, ownerSnap, keepPath = null, uid = null) {
    if (!ownerSnap?.exists) {
        return;
    }
    const owner = ownerSnap.data();
    if (uid && owner?.uid !== uid) {
        return;
    }
    const ref = refFromOwner(owner);
    if (ref?.path && ref.path !== keepPath) {
        refs.set(ref.path, ref);
    }
}

async function readOwnerSnaps(tx, refs) {
    return Promise.all(refs.map((ref) => tx.get(ref)));
}

async function setUserPush(uid, ref, next, ownerRefs) {
    const pushRefs = db.collection('users').doc(uid).collection('push');

    await db.runTransaction(async (tx) => {
        const staleRefs = new Map();
        const nextOwnerEntries = [{ kind: 'did', ref: ownerRefs.did }, ...ownerRefs.tokens];
        const [currentSnap, ...nextOwnerSnaps] = await Promise.all([
            tx.get(ref),
            ...nextOwnerEntries.map((entry) => tx.get(entry.ref)),
        ]);

        nextOwnerSnaps.forEach((snap) => addStaleOwnerRef(staleRefs, snap, ref.path));

        if (!currentSnap.exists) {
            const existingSnap = await tx.get(pushRefs.orderBy('updatedAt', 'asc').limit(MAX_PUSH_DEVICES_PER_USER));
            if (existingSnap.size >= MAX_PUSH_DEVICES_PER_USER) {
                const oldest = existingSnap.docs.find((docSnap) => docSnap.ref.path !== ref.path);
                if (oldest) {
                    staleRefs.set(oldest.ref.path, oldest.ref);
                }
            }
        }

        const nextOwnerPaths = new Set(nextOwnerEntries.map((entry) => entry.ref.path));
        const oldTokenOwnerRefs = currentSnap.exists
            ? tokenOwnerEntries(currentSnap.data())
                  .map((entry) => entry.ref)
                  .filter((oldRef) => !nextOwnerPaths.has(oldRef.path))
            : [];
        const [staleSnaps, oldTokenOwnerSnaps] = await Promise.all([
            Promise.all([...staleRefs.values()].map((staleRef) => tx.get(staleRef))),
            Promise.all(oldTokenOwnerRefs.map((oldRef) => tx.get(oldRef))),
        ]);
        staleSnaps.forEach((snap) => {
            tx.delete(snap.ref);
        });
        oldTokenOwnerSnaps.forEach((snap) => {
            const owner = snap.data();
            if (snap.exists && owner?.uid === uid && owner?.did === next.did && owner?.path === ref.path) {
                tx.delete(snap.ref);
            }
        });

        tx.set(ref, next);
        nextOwnerEntries.forEach((entry) => {
            tx.set(entry.ref, ownerData(uid, next.did, ref.path, entry.kind));
        });
    });
}

export const setPush = onCall(loggedCall('setPush', async (context) => {
    const { auth, data } = context;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'auth');

    const uid = auth.uid;
    const next = pushDoc(data);
    const ref = pushRef(uid, next.did);
    const current = await ref.get();
    if (pushDocEquivalent(current.data(), next)) {
        return OK;
    }

    await limitPushAction(context, 'set');

    await setUserPush(uid, ref, next, {
        did: didOwnerRef(next.did),
        tokens: tokenOwnerEntries(next),
    });
    return OK;
}));

export const dropPush = onCall(loggedCall('dropPush', async (context) => {
    const { auth, data } = context;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'auth');
    await limitPushAction(context, 'drop');

    const uid = auth.uid;
    const did = data?.did == null ? null : requireDid(data.did);
    const token = optionalExpoToken(data?.token);
    const nativeToken = optionalNativeToken(data?.nativeToken);
    const directRefs = new Map();
    const ownerRefs = [];

    if (did) {
        const ref = pushRef(uid, did);
        directRefs.set(ref.path, ref);
        ownerRefs.push(didOwnerRef(did));
    }

    tokenOwnerEntries({ nativeToken, token }).forEach((entry) => ownerRefs.push(entry.ref));

    await db.runTransaction(async (tx) => {
        const refs = new Map(directRefs);
        const ownerSnaps = await readOwnerSnaps(tx, ownerRefs);
        ownerSnaps.forEach((snap) => addStaleOwnerRef(refs, snap, null, uid));
        const pushSnaps = await Promise.all([...refs.values()].map((ref) => tx.get(ref)));
        pushSnaps.forEach((snap) => {
            tx.delete(snap.ref);
        });
        ownerSnaps.forEach((snap) => {
            if (snap.exists && snap.data()?.uid === uid) {
                tx.delete(snap.ref);
            }
        });
    });

    return OK;
}));
