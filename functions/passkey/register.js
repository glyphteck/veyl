import admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { randomBytes } from 'node:crypto';
import { bufferToBase64url, encodeOptionsForClient, decodeCredentialFromClient, getRpIdForOrigin, createFido2Lib, storeChallenge, consumeChallenge, validateOrigin, resolveOrigin, isRpIdHashMismatch } from '../lib/passkey.js';
import { HOUR_MS, MINUTE_MS, ipLimitKey, limitCallable } from '../lib/ratelimit.js';
import { ensureUserDoc } from '../lib/userdoc.js';
import { accountCreateIpLimitRules } from '../lib/abuseconfig.js';
import { loggedCall } from '../lib/actionlog.js';

const db = admin.firestore();

function newUid() {
    return randomBytes(20).toString('base64url');
}

function parseClientData(clientDataJSON) {
    try {
        return JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString());
    } catch {
        throw new HttpsError('invalid-argument', 'Invalid passkey client data.');
    }
}

function cleanLabel(value, fallback) {
    const label = typeof value === 'string' ? value.trim() : '';
    return label ? label.slice(0, 64) : fallback;
}

function challengeMatchesRegistration(record, { origin, rpId }) {
    return record?.type === 'register' && typeof record.uid === 'string' && record.uid && record.origin === origin && record.rpId === rpId;
}

async function limitRegisterOptions(context, origin) {
    const key = ipLimitKey(context, 'passkey-register-options', origin);
    await limitCallable(context, [
        { name: 'passkey-register-options-minute', key, limit: 10, windowMs: MINUTE_MS },
        { name: 'passkey-register-options-hour', key, limit: 60, windowMs: HOUR_MS },
    ]);
}

async function limitRegisterVerify(context, origin) {
    const key = ipLimitKey(context, 'passkey-register-verify', origin);
    await limitCallable(context, [
        { name: 'passkey-register-verify-minute', key, limit: 20, windowMs: MINUTE_MS },
        { name: 'passkey-register-verify-hour', key, limit: 120, windowMs: HOUR_MS },
    ]);
}

async function limitAccountCreate(context) {
    await limitCallable(context, accountCreateIpLimitRules(ipLimitKey(context, 'account-create')));
}

/* 1. Generate passkey registration options */
export const passkeyRegisterOptions = onCall(loggedCall('passkeyRegisterOptions', async (context) => {
    const origin = resolveOrigin(context);
    if (!validateOrigin(origin)) {
        throw new HttpsError('permission-denied', 'Invalid origin');
    }
    await limitRegisterOptions(context, origin);
    const rpId = getRpIdForOrigin(origin);
    const fido = createFido2Lib(rpId);
    const options = await fido.attestationOptions();
    const uid = newUid();
    const label = cleanLabel(context.data?.label, uid);

    // Set user info
    options.user = {
        id: Buffer.from(uid),
        name: label,
        displayName: label,
    };

    // Store challenge
    const challengeString = bufferToBase64url(options.challenge);
    await storeChallenge(challengeString, {
        origin,
        rpId,
        type: 'register',
        uid,
    });

    return {
        uid,
        opts: encodeOptionsForClient(options),
    };
}));

/* 2. Verify passkey registration */
export const passkeyRegisterVerify = onCall(loggedCall('passkeyRegisterVerify', async (context) => {
    const { data } = context;
    const { attestation } = data ?? {};
    if (!attestation) {
        throw new HttpsError('invalid-argument', 'attestation required');
    }
    // Extract challenge and origin from clientDataJSON
    const clientDataJSON = parseClientData(attestation.response?.clientDataJSON);

    // Validate origin
    if (!validateOrigin(clientDataJSON.origin)) {
        throw new HttpsError('permission-denied', 'Invalid origin');
    }
    await limitRegisterVerify(context, clientDataJSON.origin);
    // Get appropriate RP ID for the origin
    const rpId = getRpIdForOrigin(clientDataJSON.origin);
    const fido = createFido2Lib(rpId);

    // Verify challenge exists and is valid
    const challenge = await consumeChallenge(clientDataJSON.challenge);
    if (!challenge || !challengeMatchesRegistration(challenge, { origin: clientDataJSON.origin, rpId })) {
        throw new HttpsError('deadline-exceeded', 'Invalid or expired challenge');
    }
    const uid = challenge.uid;

    // Convert credential to proper format for fido2-lib
    const decodedCredential = decodeCredentialFromClient(attestation);

    // Verify attestation
    let result;
    try {
        result = await fido.attestationResult(decodedCredential, {
            challenge: challenge.challenge,
            origin: clientDataJSON.origin,
            rpId,
            factor: 'first',
        });
    } catch (error) {
        if (isRpIdHashMismatch(error)) {
            throw new HttpsError('failed-precondition', 'This passkey belongs to a different Glyphteck passkey setup. Retry with a newly created passkey.');
        }
        throw new HttpsError('invalid-argument', error?.message || 'Passkey registration failed');
    }

    // Extract credential info
    const credentialId = bufferToBase64url(result.authnrData.get('credId'));
    const PK = result.authnrData.get('credentialPublicKeyPem');
    const counter = result.authnrData.get('counter') ?? 0;

    // Store credential
    await limitAccountCreate(context);
    let authUserCreated = false;
    try {
        await admin.auth().createUser({ uid });
        authUserCreated = true;
        await db.collection('passkeys').doc(credentialId).create({
            uid,
            PK,
            counter,
            rpId,
        });
    } catch (error) {
        if (authUserCreated) {
            await admin.auth().deleteUser(uid).catch(() => {});
        }
        if (error?.code === 6 || error?.code === 'already-exists') {
            throw new HttpsError('already-exists', 'Passkey already registered.');
        }
        throw error;
    }
    await ensureUserDoc(uid);

    // Create auth token
    const token = await admin.auth().createCustomToken(uid);
    return { token };
}));
