import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, OK } from '../../lib/admin.js';
import { HOUR_MS, limitCallable, uidLimitKey } from '../../lib/ratelimit.js';
import { loggedCall } from '../../lib/actionlog.js';

const WALLET_NETWORKS = new Set(['MAINNET', 'REGTEST', 'TESTNET', 'SIGNET', 'LOCAL']);

function normalizeWalletNetwork(value) {
    const next = String(value ?? '').trim().toUpperCase();
    if (!WALLET_NETWORKS.has(next)) {
        throw new HttpsError('invalid-argument', 'Invalid wallet network.');
    }
    return next;
}

export const setWalletPK = onCall(loggedCall('setWalletPK', async (context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'You must be authenticated.');
    await limitCallable(context, {
        name: 'set-wallet-pk-uid-hour',
        key: uidLimitKey(context.auth.uid, 'set-wallet-pk'),
        limit: 60,
        windowMs: HOUR_MS,
    });
    const walletPK = typeof context.data?.walletPK === 'string' ? context.data.walletPK.trim().toLowerCase() : '';
    const network = normalizeWalletNetwork(context.data?.network);
    if (!/^0[2-3][0-9a-f]{64}$/i.test(walletPK)) {
        throw new HttpsError('invalid-argument', 'Invalid wallet identity.');
    }

    const profileRef = db.collection('profiles').doc(context.auth.uid);
    await db.runTransaction(async (tx) => {
        const profileSnap = await tx.get(profileRef);
        const profileData = profileSnap.data() || {};
        const walletPKs = profileData.walletPKs && typeof profileData.walletPKs === 'object' ? profileData.walletPKs : {};
        const existingWalletPK = typeof walletPKs[network] === 'string' ? walletPKs[network].trim() : '';
        if (existingWalletPK) {
            if (existingWalletPK.toLowerCase() === walletPK.toLowerCase()) {
                if (walletPKs[network] !== walletPK) {
                    tx.set(profileRef, { walletPKs: { [network]: walletPK } }, { merge: true });
                }
                return;
            }
            throw new HttpsError('already-exists', 'Wallet identity already set.');
        }

        const duplicateSnap = await tx.get(db.collection('profiles').where(`walletPKs.${network}`, '==', walletPK).limit(1));
        const duplicateProfile = duplicateSnap.docs.find((doc) => doc.id !== context.auth.uid);
        if (duplicateProfile) {
            throw new HttpsError('already-exists', 'Wallet identity already in use.');
        }

        tx.set(profileRef, { walletPKs: { [network]: walletPK } }, { merge: true });
    });
    return OK;
}));

export const setChatPK = onCall(loggedCall('setChatPK', async (context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'You must be authenticated.');
    await limitCallable(context, {
        name: 'set-chat-pk-uid-hour',
        key: uidLimitKey(context.auth.uid, 'set-chat-pk'),
        limit: 60,
        windowMs: HOUR_MS,
    });
    const chatPK = typeof context.data?.chatPK === 'string' ? context.data.chatPK.trim().toLowerCase() : '';

    // sanity check: x25519 pubkey hex, 64 chars
    if (!/^[0-9a-f]{64}$/i.test(chatPK)) {
        throw new HttpsError('invalid-argument', 'Invalid chat identity.');
    }

    const profileRef = db.collection('profiles').doc(context.auth.uid);
    await db.runTransaction(async (tx) => {
        const profileSnap = await tx.get(profileRef);
        const profileData = profileSnap.data() || {};
        const existingChatPK = typeof profileData.chatPK === 'string' ? profileData.chatPK.trim().toLowerCase() : '';
        if (existingChatPK) {
            if (existingChatPK === chatPK) {
                return;
            }
            throw new HttpsError('already-exists', 'Chat identity already set.');
        }

        const duplicateSnap = await tx.get(db.collection('profiles').where('chatPK', '==', chatPK).limit(1));
        const duplicateProfile = duplicateSnap.docs.find((doc) => doc.id !== context.auth.uid);
        if (duplicateProfile) {
            throw new HttpsError('already-exists', 'Chat identity already in use.');
        }

        tx.set(profileRef, { chatPK }, { merge: true });
    });
    return OK;
}));
