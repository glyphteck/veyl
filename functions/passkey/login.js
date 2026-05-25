import admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
    bufferToBase64url,
    encodeOptionsForClient,
    decodeCredentialFromClient,
    getRpIdForOrigin,
    createFido2Lib,
    storeChallenge,
    consumeChallenge,
    validateOrigin,
    resolveOrigin,
    isRpIdHashMismatch,
} from '../lib/passkey.js';
import { ensureUserDoc } from '../lib/userdoc.js';

const db = admin.firestore();
const UNLINKED_PASSKEY = 'Passkey is not linked to an account';
const LOCALHOST_PASSKEY_MISMATCH = 'This passkey was created for a different local host. Use the matching local veyl host or register a new passkey.';

function cleanUid(value) {
    return typeof value === 'string' ? value.trim() : '';
}

async function getCredentialsForUid(uid, rpId) {
    const clean = cleanUid(uid);
    if (!clean) {
        return [];
    }

    const snap = await db.collection('passkeys').where('uid', '==', clean).get();
    return snap.docs
        .map((doc) => {
            const data = doc.data() || {};
            if (data.rpId !== rpId) {
                return null;
            }
            return {
                type: 'public-key',
                id: Buffer.from(doc.id, 'base64url'),
            };
        })
        .filter(Boolean);
}

/* 3. Generate passkey login options */
export const passkeyLoginOptions = onCall(async (context) => {
    const origin = resolveOrigin(context);
    if (!validateOrigin(origin)) {
        throw new HttpsError('permission-denied', 'Invalid origin');
    }
    const rpId = getRpIdForOrigin(origin);
    const fido = createFido2Lib(rpId);

    const options = await fido.assertionOptions();
    const uid = cleanUid(context.data?.uid);
    if (uid) {
        const allowCredentials = await getCredentialsForUid(uid, rpId);
        if (!allowCredentials.length) {
            throw new HttpsError('not-found', UNLINKED_PASSKEY);
        }
        options.allowCredentials = allowCredentials;
    }

    // Store challenge
    const challengeString = bufferToBase64url(options.challenge);
    await storeChallenge(challengeString);

    return {
        opts: encodeOptionsForClient(options),
    };
});

/* 4. Verify passkey login */
export const passkeyLoginVerify = onCall(async ({ data }) => {
    const { assertion } = data ?? {};
    if (!assertion) {
        throw new HttpsError('invalid-argument', 'assertion required');
    }

    const clientDataJSON = JSON.parse(Buffer.from(assertion.response.clientDataJSON, 'base64url').toString());

    // Validate origin before looking up credential state.
    if (!validateOrigin(clientDataJSON.origin)) {
        throw new HttpsError('permission-denied', 'Invalid origin');
    }

    const rpId = getRpIdForOrigin(clientDataJSON.origin);

    // Get credential from database
    const credentialId = assertion.rawId;
    const credDoc = await db.collection('passkeys').doc(credentialId).get();
    if (!credDoc.exists) {
        if (rpId === 'localhost') {
            throw new HttpsError('failed-precondition', LOCALHOST_PASSKEY_MISMATCH);
        }
        throw new HttpsError('not-found', UNLINKED_PASSKEY);
    }

    const cred = credDoc.data() || {};
    const uid = cred.uid;
    const PK = cred.PK;
    const counter = Number.isFinite(Number(cred.counter)) ? Number(cred.counter) : 0;

    if (!uid || !PK) {
        throw new HttpsError('not-found', UNLINKED_PASSKEY);
    }

    try {
        await admin.auth().getUser(uid);
    } catch (error) {
        if (error?.code === 'auth/user-not-found') {
            await credDoc.ref.delete().catch(() => {});
            throw new HttpsError('not-found', UNLINKED_PASSKEY);
        }
        throw error;
    }

    const fido = createFido2Lib(rpId);

    // Verify challenge exists and is valid
    const challenge = await consumeChallenge(clientDataJSON.challenge);
    if (!challenge) {
        throw new HttpsError('deadline-exceeded', 'Invalid or expired challenge');
    }

    // Convert assertion to proper format for fido2-lib
    const decodedAssertion = decodeCredentialFromClient(assertion);

    // Verify assertion
    let result;
    try {
        result = await fido.assertionResult(decodedAssertion, {
            challenge,
            origin: clientDataJSON.origin,
            rpId,
            factor: 'either',
            publicKey: PK,
            prevCounter: counter,
            userHandle: Buffer.from(uid),
        });
    } catch (error) {
        if (isRpIdHashMismatch(error)) {
            if (rpId === 'localhost') {
                throw new HttpsError('failed-precondition', LOCALHOST_PASSKEY_MISMATCH);
            }
            throw new HttpsError('failed-precondition', 'This passkey belongs to a different Glyphteck passkey setup. Register a new passkey.');
        }
        throw error;
    }

    // Update stored credential metadata after a successful assertion
    const newCounter = result.authnrData.get('counter');
    if (newCounter !== undefined) {
        await credDoc.ref.set({ counter: newCounter }, { merge: true });
    }

    await ensureUserDoc(uid);

    // Create auth token
    const token = await admin.auth().createCustomToken(uid);
    return { token };
});
