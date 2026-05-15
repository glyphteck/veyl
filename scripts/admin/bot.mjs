#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import admin, { db, projectId } from '../../functions/lib/admin.js';
import { BOT_MODE } from '../../shared/bot/events.js';
import { resolveBotUid, setBotPowerState } from '../../functions/lib/bots.js';
import { provisionBot } from '../../apps/veyl/bot/src/newbot.js';
import { createSecretClient, deleteBotSeed } from '../../apps/veyl/bot/src/secrets.js';
import { cliArgs } from './common.mjs';

function usage() {
    console.error('usage: pnpm bot add [username|count]');
    console.error('usage: pnpm bot power <@username|uid|all> <on|off>');
    console.error('usage: pnpm bot kill <@username|uid|all>');
    process.exit(1);
}

function normalizeTarget(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return 'all';
    }

    const clean = raw.replace(/^@/, '').trim().toLowerCase();
    return clean || 'all';
}

function normalizePower(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (['1', 'on', 'true', 'enable', 'enabled'].includes(raw)) {
        return true;
    }
    if (['0', 'off', 'false', 'disable', 'disabled'].includes(raw)) {
        return false;
    }
    return null;
}

function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

async function resolveBotTargets(target) {
    const nextTarget = normalizeTarget(target);

    if (nextTarget === 'all') {
        const [botsSnap, profilesSnap] = await Promise.all([
            db.collection('bots').get(),
            db.collection('profiles').where('bot', '==', BOT_MODE).get(),
        ]);

        const targets = new Map();
        for (const docSnap of botsSnap.docs) {
            targets.set(docSnap.id, {
                uid: docSnap.id,
                username: String(docSnap.data()?.username || '').trim().toLowerCase() || null,
            });
        }

        for (const docSnap of profilesSnap.docs) {
            if (targets.has(docSnap.id)) {
                continue;
            }

            targets.set(docSnap.id, {
                uid: docSnap.id,
                username: String(docSnap.data()?.username || '').trim().toLowerCase() || null,
            });
        }

        return [...targets.values()];
    }

    const uid = await resolveBotUid(nextTarget);
    if (!uid) {
        throw new Error(`bot not found: ${target}`);
    }

    const [botSnap, profileSnap] = await Promise.all([
        db.collection('bots').doc(uid).get(),
        db.collection('profiles').doc(uid).get(),
    ]);

    return [{
        uid,
        username: String(botSnap.data()?.username || profileSnap.data()?.username || '').trim().toLowerCase() || null,
    }];
}

async function deleteBotChats(bucket, chatPK) {
    if (!chatPK) {
        return 0;
    }

    const chats = await db.collection('chats').where('participants', 'array-contains', chatPK).get();
    for (const docSnap of chats.docs) {
        await db.recursiveDelete(docSnap.ref);
        await bucket.deleteFiles({ prefix: `chatmedia/${docSnap.id}/` }).catch(() => {});
    }

    return chats.docs.length;
}

async function deleteBot(target, options = {}) {
    const { deleteAuth = false, deleteSecret = false, secretClient = null } = options;
    const bucket = admin.storage().bucket();
    const botRef = db.collection('bots').doc(target.uid);
    const profileRef = db.collection('profiles').doc(target.uid);
    const moderationRef = db.collection('moderation').doc(target.uid);
    const usersRef = db.collection('users').doc(target.uid);

    const [botSnap, profileSnap] = await Promise.all([botRef.get(), profileRef.get()]);
    const botData = botSnap.exists ? botSnap.data() : {};
    const profileData = profileSnap.exists ? profileSnap.data() : {};
    const username = String(botData?.username || profileData?.username || target.username || '').trim().toLowerCase();
    const chatPK = String(botData?.chatPK || profileData?.chatPK || '').trim();

    await setBotPowerState(target.uid, false).catch(() => {});

    const chatsDeleted = await deleteBotChats(bucket, chatPK);

    await Promise.all([
        db.recursiveDelete(usersRef).catch(() => {}),
        db.recursiveDelete(botRef).catch(() => {}),
        bucket.file(`${target.uid}/avatar.webp`).delete({ ignoreNotFound: true }).catch(() => {}),
    ]);

    const batch = db.batch();
    const deletedUsernames = new Set();

    batch.delete(profileRef);
    batch.delete(moderationRef);

    if (chatPK) {
        batch.delete(db.collection('chatkeys').doc(chatPK));
    }

    if (username) {
        batch.delete(db.collection('usernames').doc(username));
        deletedUsernames.add(username);
    }

    const usernamesSnap = await db.collection('usernames').where('uid', '==', target.uid).get();
    usernamesSnap.forEach((docSnap) => {
        if (deletedUsernames.has(docSnap.id)) {
            return;
        }
        deletedUsernames.add(docSnap.id);
        batch.delete(docSnap.ref);
    });

    await batch.commit();

    if (deleteAuth) {
        await admin.auth().deleteUser(target.uid).catch((error) => {
            if (error?.code !== 'auth/user-not-found') {
                throw error;
            }
        });
    }

    if (deleteSecret && secretClient && username) {
        await deleteBotSeed(secretClient, projectId, username);
    }

    return {
        uid: target.uid,
        username: username || null,
        chatsDeleted,
        authDeleted: deleteAuth,
        secretDeleted: Boolean(deleteSecret && username),
    };
}

export async function nukeBots(target = 'all', options = {}) {
    const { deleteAuth = false, deleteSecret = false } = options;
    const targets = await resolveBotTargets(target);
    const wiped = [];
    const secretClient = deleteSecret ? createSecretClient() : null;

    for (const entry of targets) {
        wiped.push(await deleteBot(entry, { deleteAuth, deleteSecret, secretClient }));
    }

    return {
        count: wiped.length,
        wiped,
    };
}

export async function killBots(target = 'all') {
    return nukeBots(target, {
        deleteAuth: true,
        deleteSecret: true,
    });
}

export async function powerBots(target, enabled) {
    const targets = await resolveBotTargets(target);
    const updated = [];

    for (const entry of targets) {
        await setBotPowerState(entry.uid, enabled);
        updated.push(entry);
    }

    return {
        count: updated.length,
        enabled,
        updated,
    };
}

export async function addBot(target) {
    const result = await provisionBot(target);
    await setBotPowerState(result.uid, true);
    return result;
}

function printPowerResult(result) {
    const names = result.updated.map((entry) => entry.username ? `@${entry.username}` : entry.uid).join(', ');
    const suffix = names ? `: ${names}` : '';
    console.log(`${result.enabled ? 'powered on' : 'powered off'} ${plural(result.count, 'bot')}${suffix}`);
}

function printKillResult(result) {
    const names = result.wiped.map((entry) => entry.username ? `@${entry.username}` : entry.uid).join(', ');
    const chatsDeleted = result.wiped.reduce((sum, entry) => sum + (entry.chatsDeleted || 0), 0);
    const suffix = names ? `: ${names}` : '';
    console.log(`deleted ${plural(result.count, 'bot account')}, ${plural(chatsDeleted, 'chat')}, auth users, and bot seeds${suffix}`);
}

async function main() {
    const [action, arg1, arg2] = cliArgs();
    const cmd = String(action ?? '').trim().toLowerCase();

    if (!cmd) {
        usage();
    }

    if (cmd === 'add') {
        const count = arg1 ? Number.parseInt(arg1, 10) : NaN;
        if (Number.isFinite(count) && count > 0) {
            for (let i = 0; i < count; i++) {
                const result = await addBot(null);
                console.log(`added and enabled @${result.username} (${result.uid})`);
            }
            return;
        }

        const result = await addBot(arg1 || null);
        console.log(`added and enabled @${result.username} (${result.uid})`);
        return;
    }

    if (cmd === 'power') {
        if (!arg1) {
            usage();
        }

        const enabled = normalizePower(arg2);
        if (enabled === null) {
            usage();
        }

        const result = await powerBots(arg1, enabled);
        printPowerResult(result);
        return;
    }

    if (cmd === 'kill') {
        if (!arg1) {
            usage();
        }

        const result = await killBots(arg1);
        printKillResult(result);
        return;
    }

    usage();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error?.message || error);
        process.exit(1);
    });
}