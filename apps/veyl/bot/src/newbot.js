import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SparkWallet } from '@buildonspark/spark-sdk';
import { generateSeed } from '@glyphteck/shared/crypto/seed';
import { resolveNetwork } from '@glyphteck/shared/network';
import { normalizeWalletNetwork, resolveWalletPK, walletPKPatch } from '@glyphteck/shared/walletkeys';
import { BOT_MODE } from '@glyphteck/shared/bot/events';
import { bootBotAccount, closeBotAccount } from '@glyphteck/shared/bot/account';
import admin, { db, FieldValue, projectId } from './admin.js';
import { createSecretClient, ensureBotSeed } from './secrets.js';
import { ensureUserDoc } from '../../../../functions/lib/userdoc.js';
import { MAX_USERNAME, isUsername, normalizeUsername } from '../../../../functions/lib/regex.js';

function sameKey(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

async function resolveUid(username) {
    const [usernameSnap, botsSnap] = await Promise.all([
        db.collection('usernames').doc(username).get(),
        db.collection('bots').where('username', '==', username).limit(1).get(),
    ]);

    const usernameUid = typeof usernameSnap.data()?.uid === 'string' ? usernameSnap.data().uid.trim() : '';
    const botUid = botsSnap.docs[0]?.id || '';

    if (usernameUid && botUid && usernameUid !== botUid) {
        throw new Error(`username/bot uid mismatch for @${username}`);
    }

    return usernameUid || botUid || '';
}

async function ensureAuthUser(uid, username) {
    if (uid) {
        try {
            await admin.auth().getUser(uid);
            return uid;
        } catch {}

        await admin.auth().createUser({
            uid,
            displayName: `@${username}`,
        });
        return uid;
    }

    return (
        await admin.auth().createUser({
            displayName: `@${username}`,
        })
    ).uid;
}

async function syncDocs({ uid, username, walletPK, chatPK, network }) {
    const walletNetwork = normalizeWalletNetwork(network);
    const botRef = db.collection('bots').doc(uid);
    const profileRef = db.collection('profiles').doc(uid);
    const usernameRef = db.collection('usernames').doc(username);
    const chatKeyRef = db.collection('chatkeys').doc(chatPK);

    await db.runTransaction(async (tx) => {
        const [botSnap, profileSnap, usernameSnap, chatKeySnap] = await Promise.all([tx.get(botRef), tx.get(profileRef), tx.get(usernameRef), tx.get(chatKeyRef)]);

        const reservedUid = typeof usernameSnap.data()?.uid === 'string' ? usernameSnap.data().uid.trim() : '';
        if (reservedUid && reservedUid !== uid) {
            throw new Error(`@${username} is already reserved`);
        }

        const chatKeyUid = typeof chatKeySnap.data()?.uid === 'string' ? chatKeySnap.data().uid.trim() : '';
        if (chatKeyUid && chatKeyUid !== uid) {
            throw new Error('chat key already belongs to another account');
        }

        const profileData = profileSnap.exists ? profileSnap.data() : {};
        const existingProfileWalletPK = resolveWalletPK(profileData, walletNetwork);
        if (existingProfileWalletPK && !sameKey(existingProfileWalletPK, walletPK)) {
            throw new Error('wallet key mismatch on profile');
        }
        if (profileData?.chatPK && String(profileData.chatPK).toLowerCase() !== String(chatPK).toLowerCase()) {
            throw new Error('chat key mismatch on profile');
        }

        const botData = botSnap.exists ? botSnap.data() : {};
        const existingBotWalletPK = resolveWalletPK(botData, walletNetwork);
        if (existingBotWalletPK && !sameKey(existingBotWalletPK, walletPK)) {
            throw new Error('wallet key mismatch on bot');
        }

        tx.set(usernameRef, { uid }, { merge: true });
        tx.set(
            profileRef,
            {
                username,
                ...walletPKPatch(walletPK, walletNetwork),
                chatPK,
                active: false,
                bot: BOT_MODE,
            },
            { merge: true }
        );
        tx.set(
            chatKeyRef,
            {
                uid,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
        tx.set(
            botRef,
            {
                username,
                enabled: false,
                mode: BOT_MODE,
                status: 'off',
                lastBootAt: botData?.lastBootAt ?? null,
                lastRunAt: botData?.lastRunAt ?? null,
                lastError: null,
                resumeAt: botData?.resumeAt ?? null,
                ...walletPKPatch(walletPK, walletNetwork),
                chatPK,
            },
            { merge: true }
        );
    });
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomUsername() {
    const bytes = randomBytes(MAX_USERNAME);
    let name = '';
    for (let i = 0; i < MAX_USERNAME; i++) {
        name += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return name;
}

async function generateUniqueUsername(maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        const name = randomUsername();
        const snap = await db.collection('usernames').doc(name).get();
        if (!snap.exists) {
            return name;
        }
    }
    throw new Error('could not generate unique username');
}

export async function provisionBot(rawInput) {
    const rawArg = String(rawInput || '').trim().replace(/^@/, '');
    const username = rawArg
        ? normalizeUsername(rawArg)
        : await generateUniqueUsername();

    if (!isUsername(username)) {
        throw new Error(`invalid bot username: "${rawArg}" (must be 1-12 lowercase alphanumeric)`);
    }

    const secretClient = createSecretClient();
    const seedInput = generateSeed();
    let seed = null;
    let account = null;
    const network = resolveNetwork(process.env);

    try {
        const ensured = await ensureBotSeed(secretClient, projectId, username, seedInput);
        seed = ensured.seed;
        const existingUid = await resolveUid(username);
        account = await bootBotAccount(seed, {
            SparkWallet,
            network,
        });

        const uid = await ensureAuthUser(existingUid, username);
        await ensureUserDoc(uid);
        await syncDocs({
            uid,
            username,
            walletPK: account.walletPK,
            chatPK: account.chatPK,
            network,
        });

        const user = await admin.auth().getUser(uid);
        await admin.auth().setCustomUserClaims(uid, {
            ...(user.customClaims || {}),
            bot: true,
        });

        return {
            uid,
            username,
            walletPK: account.walletPK,
            chatPK: account.chatPK,
            seedCreated: ensured.created,
        };
    } finally {
        seedInput.fill(0);
        seed?.fill?.(0);
        closeBotAccount(account);
    }
}

async function main() {
    const result = await provisionBot(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error?.message || error);
        process.exit(1);
    });
}
