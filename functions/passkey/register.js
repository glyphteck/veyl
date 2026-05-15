import admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { bufferToBase64url, encodeOptionsForClient, decodeCredentialFromClient, getRpIdForOrigin, createFido2Lib, storeChallenge, consumeChallenge, validateOrigin, resolveOrigin, isRpIdHashMismatch } from '../lib/passkey.js';
import { ensureUserDoc } from '../lib/userdoc.js';

const db = admin.firestore();

/* 1. Generate passkey registration options */
export const passkeyRegisterOptions = onCall(async (context) => {
    const origin = resolveOrigin(context);
    if (!validateOrigin(origin)) {
        throw new HttpsError('permission-denied', 'Invalid origin');
    }
    const rpId = getRpIdForOrigin(origin);
    const fido = createFido2Lib(rpId);
    const options = await fido.attestationOptions();
    const uid = (await admin.auth().createUser({})).uid;
    const label = context.data?.label?.trim() || uid;

    // Set user info
    options.user = {
        id: Buffer.from(uid),
        name: label,
        displayName: label,
    };

    // Store challenge
    const challengeString = bufferToBase64url(options.challenge);
    await storeChallenge(challengeString);

    return {
        uid,
        opts: encodeOptionsForClient(options),
    };
});

/* 2. Verify passkey registration */
export const passkeyRegisterVerify = onCall(async ({ data }) => {
    const { uid, attestation } = data ?? {};
    if (!uid || !attestation) {
        throw new HttpsError('invalid-argument', 'uid and attestation required');
    }
    // Extract challenge and origin from clientDataJSON
    const clientDataJSON = JSON.parse(Buffer.from(attestation.response.clientDataJSON, 'base64url').toString());

    // Validate origin
    if (!validateOrigin(clientDataJSON.origin)) {
        throw new HttpsError('permission-denied', 'Invalid origin');
    }
    // Get appropriate RP ID for the origin
    const rpId = getRpIdForOrigin(clientDataJSON.origin);
    const fido = createFido2Lib(rpId);

    // Verify challenge exists and is valid
    const challenge = await consumeChallenge(clientDataJSON.challenge);
    if (!challenge) {
        throw new HttpsError('deadline-exceeded', 'Invalid or expired challenge');
    }

    // Convert credential to proper format for fido2-lib
    const decodedCredential = decodeCredentialFromClient(attestation);

    // Verify attestation
    let result;
    try {
        result = await fido.attestationResult(decodedCredential, {
            challenge,
            origin: clientDataJSON.origin,
            rpId,
            factor: 'either',
        });
    } catch (error) {
        if (isRpIdHashMismatch(error)) {
            throw new HttpsError('failed-precondition', 'This passkey belongs to a different Gliftec passkey setup. Retry with a newly created passkey.');
        }
        throw new HttpsError('invalid-argument', error?.message || 'Passkey registration failed');
    }

    // Extract credential info
    const credentialId = bufferToBase64url(result.authnrData.get('credId'));
    const PK = result.authnrData.get('credentialPublicKeyPem');
    const counter = result.authnrData.get('counter') ?? 0;

    // Store credential
    await db.collection('passkeys').doc(credentialId).set({
        uid,
        PK,
        counter,
        rpId,
    });
    await ensureUserDoc(uid);

    // Create auth token
    const token = await admin.auth().createCustomToken(uid);
    return { token };
});
