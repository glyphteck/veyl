import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SparkWallet } from '@buildonspark/spark-sdk';
import { generateSeed } from '@veyl/shared/crypto/seed';
import { resolveNetwork } from '@veyl/shared/network';
import { normalizeWalletNetwork, resolveWalletPK, walletPKPatch } from '@veyl/shared/wallet/keys';
import { BOT_MODE } from '@veyl/shared/bot/events';
import { bootBotAccount, closeBotAccount } from '@veyl/shared/bot/account';
import { MAX_USERNAME, isUsername, normalizeUsername } from '@veyl/shared/username';
import { cleanText, sameText } from '@veyl/shared/utils/text';
import admin, { db, projectId } from './admin.js';
import { createSecretClient, ensureBotSeed } from './secrets.js';
import { ensureUserDoc } from '../../../functions/lib/userdoc.js';

async function resolveUid(username) {
    const [usernameSnap, botsSnap] = await Promise.all([
        db.collection('usernames').doc(username).get(),
        db.collection('bots').where('username', '==', username).limit(1).get(),
    ]);

    const usernameUid = cleanText(usernameSnap.data()?.uid);
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

    await db.runTransaction(async (tx) => {
        const [botSnap, profileSnap, usernameSnap] = await Promise.all([tx.get(botRef), tx.get(profileRef), tx.get(usernameRef)]);

        const reservedUid = cleanText(usernameSnap.data()?.uid);
        if (reservedUid && reservedUid !== uid) {
            throw new Error(`@${username} is already reserved`);
        }

        const profileData = profileSnap.exists ? profileSnap.data() : {};
        const existingProfileWalletPK = resolveWalletPK(profileData, walletNetwork);
        if (existingProfileWalletPK && !sameText(existingProfileWalletPK, walletPK)) {
            throw new Error('wallet identity mismatch on profile');
        }
        if (profileData?.chatPK && !sameText(profileData.chatPK, chatPK)) {
            throw new Error('chat identity mismatch on profile');
        }

        const botData = botSnap.exists ? botSnap.data() : {};
        const existingBotWalletPK = resolveWalletPK(botData, walletNetwork);
        if (existingBotWalletPK && !sameText(existingBotWalletPK, walletPK)) {
            throw new Error('wallet identity mismatch on bot');
        }

        tx.set(usernameRef, { uid }, { merge: true });
        tx.set(
            profileRef,
            {
                username,
                ...(profileSnap.exists ? {} : { avatar: null }),
                ...walletPKPatch(walletPK, walletNetwork),
                chatPK,
                active: false,
                bot: BOT_MODE,
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
    const rawArg = cleanText(rawInput).replace(/^@/, '');
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
            username,
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
