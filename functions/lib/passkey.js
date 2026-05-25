import { Fido2Lib } from 'fido2-lib/lib/main.js';
import { allowedPasskeyOrigins, links, PASSKEY_DOMAIN } from './links.js';
import { db, Timestamp } from './admin.js';

const LOCALHOST_RP_ID = 'localhost';

export const ALLOWED_ORIGINS = [...allowedPasskeyOrigins];
export const DEFAULT_ORIGIN = links.root;
export const PASSKEY_RP_ID = PASSKEY_DOMAIN;

export function isRpIdHashMismatch(error) {
    return typeof error?.message === 'string' && error.message.includes('rpIdHash mismatch');
}

function getOriginHostname(origin) {
    try {
        return new URL(origin).hostname;
    } catch {
        return '';
    }
}

// Convert buffer to base64url string
export function bufferToBase64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

// Convert base64url string to ArrayBuffer (required by fido2-lib)
export function base64urlToArrayBuffer(str) {
    if (!str) return undefined;
    const buffer = Buffer.from(str, 'base64url');
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// Encode FIDO2 options for client (Buffer → base64url)
export function encodeOptionsForClient(opts) {
    return {
        ...opts,
        challenge: bufferToBase64url(opts.challenge),
        user: opts.user
            ? {
                  ...opts.user,
                  id: bufferToBase64url(opts.user.id),
              }
            : undefined,
        allowCredentials: (opts.allowCredentials ?? []).map((cred) => ({
            ...cred,
            id: bufferToBase64url(cred.id),
        })),
        excludeCredentials: (opts.excludeCredentials ?? []).map((cred) => ({
            ...cred,
            id: bufferToBase64url(cred.id),
        })),
    };
}

// Decode credential from client (base64url → ArrayBuffer)
export function decodeCredentialFromClient(cred) {
    if (!cred || typeof cred !== 'object') return cred;

    return {
        ...cred,
        rawId: base64urlToArrayBuffer(cred.rawId),
        id: base64urlToArrayBuffer(cred.id),
        response: {
            ...cred.response,
            clientDataJSON: base64urlToArrayBuffer(cred.response?.clientDataJSON),
            attestationObject: base64urlToArrayBuffer(cred.response?.attestationObject),
            authenticatorData: base64urlToArrayBuffer(cred.response?.authenticatorData),
            signature: base64urlToArrayBuffer(cred.response?.signature),
            userHandle: base64urlToArrayBuffer(cred.response?.userHandle),
        },
    };
}

// Use one RP ID for all web environments.
export function getRpIdForOrigin(origin) {
    if (getOriginHostname(origin) === 'localhost') {
        return LOCALHOST_RP_ID;
    }

    return PASSKEY_RP_ID;
}

export function resolveOrigin(context = {}) {
    const requestedOrigin = typeof context.data?.origin === 'string' ? context.data.origin.trim() : '';
    const headerOrigin = typeof context.rawRequest?.headers?.origin === 'string' ? context.rawRequest.headers.origin.trim() : '';
    return requestedOrigin || headerOrigin || DEFAULT_ORIGIN;
}

// Create Fido2Lib instance factory function
export function createFido2Lib(rpId) {
    return new Fido2Lib({
        timeout: 60_000,
        rpId: rpId,
        rpName: 'Glyphteck',
        challengeSize: 32,
        attestation: 'none',
        authenticatorRequirement: 'discouraged',
        userVerification: 'discouraged',
    });
}

/* Store challenge in Firestore with TTL */
export async function storeChallenge(challengeString, ttlMs = 300_000) {
    const ttl = Timestamp.fromMillis(Date.now() + ttlMs);
    await db.collection('passkey_challenges').doc(challengeString).set({ ttl });
}

/* Retrieve and delete challenge from Firestore */
export async function consumeChallenge(challengeString) {
    const doc = await db.collection('passkey_challenges').doc(challengeString).get();
    if (!doc.exists || doc.data().ttl.toMillis() < Date.now()) {
        return null;
    }
    await doc.ref.delete();
    return challengeString;
}

/* Validate origin against allowed origins */
export function validateOrigin(origin) {
    return ALLOWED_ORIGINS.includes(origin);
}
