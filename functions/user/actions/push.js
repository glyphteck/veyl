import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, OK } from '../../lib/admin.js';

const DID_RE = /^[a-zA-Z0-9_-]{12,128}$/;
const EXPO_RE = /^(Expo|Exponent)PushToken\[[^\]]+\]$/;
const PUSH_VARIANTS = new Set(['dev', 'test', 'prod']);
const PUSH_ENVIRONMENTS = new Set(['development', 'production']);
const APNS_TOPICS = new Set(['com.glyphteck.veyl.dev', 'com.glyphteck.veyl.test', 'com.glyphteck.veyl']);
const DELETE_BATCH_SIZE = 450;

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
    if (token && (token.length < 16 || token.length > 512)) {
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

    return {
        did,
        token,
        nativeToken,
        platform: 'ios',
        provider: nativeToken ? 'apns' : 'expo',
        appVariant: requireMember(data?.appVariant, PUSH_VARIANTS, 'bad app variant'),
        apnsTopic: requireMember(data?.apnsTopic, APNS_TOPICS, 'bad apns topic'),
        apnsEnvironment: requireMember(data?.apnsEnvironment, PUSH_ENVIRONMENTS, 'bad apns environment'),
        enabled: true,
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function addRef(refs, ref) {
    if (ref?.path) {
        refs.set(ref.path, ref);
    }
}

async function queryPush(field, value, refs, keepPath = null) {
    if (!value) {
        return;
    }

    const snap = await db.collectionGroup('push').where(field, '==', value).get();
    snap.docs.forEach((docSnap) => {
        if (docSnap.ref.path !== keepPath) {
            addRef(refs, docSnap.ref);
        }
    });
}

async function queryUserPush(uid, field, value, refs, keepPath = null) {
    if (!value) {
        return;
    }

    const snap = await db.collection('users').doc(uid).collection('push').where(field, '==', value).get();
    snap.docs.forEach((docSnap) => {
        if (docSnap.ref.path !== keepPath) {
            addRef(refs, docSnap.ref);
        }
    });
}

async function deleteRefs(refs) {
    const list = [...refs.values()];
    for (let index = 0; index < list.length; index += DELETE_BATCH_SIZE) {
        const batch = db.batch();
        list.slice(index, index + DELETE_BATCH_SIZE).forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
}

export const setPush = onCall(async ({ auth, data }) => {
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'auth');

    const uid = auth.uid;
    const next = pushDoc(data);
    const ref = db.collection('users').doc(uid).collection('push').doc(next.did);
    const staleRefs = new Map();

    await Promise.all([
        queryPush('did', next.did, staleRefs, ref.path),
        queryPush('nativeToken', next.nativeToken, staleRefs, ref.path),
        queryPush('token', next.token, staleRefs, ref.path),
    ]);

    await deleteRefs(staleRefs);
    await ref.set(next);
    return OK;
});

export const dropPush = onCall(async ({ auth, data }) => {
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'auth');

    const uid = auth.uid;
    const did = data?.did == null ? null : requireDid(data.did);
    const token = optionalExpoToken(data?.token);
    const nativeToken = optionalNativeToken(data?.nativeToken);
    const refs = new Map();

    if (did) {
        addRef(refs, db.collection('users').doc(uid).collection('push').doc(did));
    }

    await Promise.all([
        queryUserPush(uid, 'nativeToken', nativeToken, refs),
        queryUserPush(uid, 'token', token, refs),
    ]);

    await deleteRefs(refs);
    return OK;
});
