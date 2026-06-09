import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import admin, { db, OK } from '../../lib/admin.js';
import { HOUR_MS, limitCallable, uidLimitKey } from '../../lib/ratelimit.js';
import { loggedCall } from '../../lib/actionlog.js';

const CURRENT_VAULT_CRYPTO = 'crypto_glyphseal_v3';
const LEGACY_V2_VAULT_CRYPTO = 'crypto_glyphseal_v2';
const MAX_VAULT_BYTES = 256 * 1024;
const HEX_32 = /^[0-9a-f]{64}$/;
const PK_HEX_32 = /^[0-9a-f]{64}$/;
const WALLET_PK = /^0[2-3][0-9a-f]{64}$/i;

function decodeBase64Bytes(value, label) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
        throw new HttpsError('invalid-argument', `${label} required`);
    }
    const bytes = Buffer.from(text, 'base64');
    if (!bytes.length || bytes.length > MAX_VAULT_BYTES) {
        throw new HttpsError('invalid-argument', `${label} size`);
    }
    return new Uint8Array(bytes);
}

function vaultHash(bytes) {
    return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function vaultCrypto(bytes) {
    const magicLen = bytes?.[0] || 0;
    if (!magicLen || magicLen > 64 || bytes.length < 1 + magicLen) {
        throw new HttpsError('invalid-argument', 'bad vault header');
    }
    return Buffer.from(bytes.subarray(1, 1 + magicLen)).toString('utf8');
}

function vaultBytesFromSnap(snap) {
    const value = snap.data()?.es;
    if (typeof value?.toUint8Array !== 'function') {
        throw new HttpsError('not-found', 'vault');
    }
    return value.toUint8Array();
}

function cleanWalletPK(value) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (text && !WALLET_PK.test(text)) {
        throw new HttpsError('invalid-argument', 'bad wallet identity');
    }
    return text;
}

function cleanChatPK(value) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (text && !PK_HEX_32.test(text)) {
        throw new HttpsError('invalid-argument', 'bad chat identity');
    }
    return text;
}

function profileWalletPK(data, network) {
    const walletPKs = data?.walletPKs && typeof data.walletPKs === 'object' ? data.walletPKs : {};
    const key = typeof network === 'string' && network.trim() ? network.trim().toUpperCase() : '';
    const value = key ? walletPKs[key] : '';
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export const replaceVault = onCall(loggedCall('replaceVault', async (context) => {
    const uid = context.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'auth');
    await limitCallable(context, {
        name: 'replace-vault-uid-hour',
        key: uidLimitKey(uid, 'replace-vault'),
        limit: 6,
        windowMs: HOUR_MS,
    });

    const expectedHash = typeof context.data?.expectedHash === 'string' ? context.data.expectedHash.trim().toLowerCase() : '';
    if (!HEX_32.test(expectedHash)) {
        throw new HttpsError('invalid-argument', 'bad vault hash');
    }

    const expectedFrom = typeof context.data?.from === 'string' ? context.data.from.trim() : '';
    if (expectedFrom && expectedFrom !== LEGACY_V2_VAULT_CRYPTO && expectedFrom !== CURRENT_VAULT_CRYPTO) {
        throw new HttpsError('invalid-argument', 'bad source vault version');
    }

    const nextVault = decodeBase64Bytes(context.data?.vault, 'vault');
    if (vaultCrypto(nextVault) !== CURRENT_VAULT_CRYPTO) {
        throw new HttpsError('invalid-argument', 'replacement vault must be current');
    }

    const walletPK = cleanWalletPK(context.data?.walletPK);
    const chatPK = cleanChatPK(context.data?.chatPK);
    const network = typeof context.data?.network === 'string' ? context.data.network.trim().toUpperCase() : '';
    const seedRef = db.collection('seeds').doc(uid);
    const profileRef = db.collection('profiles').doc(uid);

    await db.runTransaction(async (tx) => {
        const [seedSnap, profileSnap] = await Promise.all([tx.get(seedRef), tx.get(profileRef)]);
        const currentVault = vaultBytesFromSnap(seedSnap);
        const currentCrypto = vaultCrypto(currentVault);
        if (expectedFrom && currentCrypto !== expectedFrom) {
            throw new HttpsError('failed-precondition', 'vault version changed');
        }
        if (vaultHash(currentVault) !== expectedHash) {
            throw new HttpsError('failed-precondition', 'vault changed');
        }

        const profile = profileSnap.data() || {};
        if (walletPK && network && profileWalletPK(profile, network) !== walletPK) {
            throw new HttpsError('failed-precondition', 'wallet identity changed');
        }
        if (chatPK && cleanChatPK(profile.chatPK) !== chatPK) {
            throw new HttpsError('failed-precondition', 'chat identity changed');
        }

        tx.set(seedRef, { es: admin.firestore.Bytes.fromUint8Array(nextVault) });
    });

    return OK;
}));
