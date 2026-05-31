#!/usr/bin/env bun

import { fileURLToPath } from 'node:url';
import admin, { db, FieldValue, projectId } from '../../functions/lib/admin.js';
import {
    BOT_ACTION_STATUS_DONE,
    BOT_ACTION_STATUS_ERROR,
    BOT_ACTION_STATUS_QUEUED,
    BOT_ACTION_TYPE_BURST,
    BOT_MODE,
    BOT_RUNTIME_ACTIONS,
    BOT_RUNTIME_DOC_ID,
    BOT_RUNTIME_LEASE_MS,
} from '@veyl/shared/bot/events';
import { cleanBurstCount, cleanBurstDelayMs } from '@veyl/shared/bot/burst';
import {
    BOT_BURST_DEFAULT_COUNT,
    BOT_BURST_DEFAULT_DELAY_MS,
} from '@veyl/shared/config';
import { resolveBotUid, setBotPowerState } from '../../functions/lib/bots.js';
import { provisionBot } from '../../apps/veyl/bot/src/newbot.js';
import { createSecretClient, deleteBotSeed } from '../../apps/veyl/bot/src/secrets.js';
import { cliArgs, resolveUid } from './cli.mjs';
import { timestampMs } from '@veyl/shared/utils/time';
import { sleep } from '@veyl/shared/utils/async';
import { cleanText, lowerText } from '@veyl/shared/utils/text';

const DEFAULT_BURST_TARGET = '@zxrl';
const BURST_WAIT_POLL_MS = 2000;
const BURST_WAIT_GRACE_MS = 60000;

function usage() {
    console.error('usage: bun bot add [username|count]');
    console.error('usage: bun bot power <@username|uid|all> <on|off>');
    console.error('usage: bun bot kill <@username|uid|all>');
    console.error('usage: bun bot burst [@username|uid] [--count 60] [--delay 3000|3s] [--no-wait]');
    console.error('usage: bun bot b [@username|uid] [--count 60] [--delay 3000|3s] [--no-wait]');
    process.exit(1);
}

function normalizeTarget(value) {
    const raw = cleanText(value);
    if (!raw) {
        return 'all';
    }

    const clean = lowerText(raw.replace(/^@/, ''));
    return clean || 'all';
}

function normalizePower(value) {
    const raw = lowerText(value);
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

function runtimeRef() {
    return db.collection('runtimes').doc(BOT_RUNTIME_DOC_ID);
}

function isRuntimeActive(data) {
    return data?.running === true && timestampMs(data?.heartbeatAt, 0) > Date.now() - BOT_RUNTIME_LEASE_MS;
}

function supportsRuntimeAction(data, actionType) {
    return Array.isArray(data?.actions) && data.actions.includes(actionType);
}

function msLabel(ms) {
    return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

function parseCount(value) {
    return cleanBurstCount(value, 'count');
}

function parseDelayMs(value) {
    return cleanBurstDelayMs(value, { name: 'delay', text: true });
}

function splitOption(arg) {
    const raw = String(arg ?? '').trim();
    const eq = raw.indexOf('=');
    if (eq === -1) {
        return { name: raw, value: null };
    }
    return {
        name: raw.slice(0, eq),
        value: raw.slice(eq + 1),
    };
}

function readOptionValue(args, index, inlineValue) {
    if (inlineValue != null) {
        return { value: inlineValue, index };
    }
    if (index + 1 >= args.length) {
        usage();
    }
    return { value: args[index + 1], index: index + 1 };
}

function parseBurstArgs(args) {
    let target = DEFAULT_BURST_TARGET;
    let targetSet = false;
    let count = BOT_BURST_DEFAULT_COUNT;
    let delayMs = BOT_BURST_DEFAULT_DELAY_MS;
    let wait = true;

    for (let i = 0; i < args.length; i++) {
        const raw = String(args[i] ?? '').trim();
        if (!raw) {
            continue;
        }

        const { name, value } = splitOption(raw);
        if (name === '--count' || name === '-c') {
            const next = readOptionValue(args, i, value);
            count = parseCount(next.value);
            i = next.index;
            continue;
        }
        if (name === '--delay' || name === '--delay-ms' || name === '-d') {
            const next = readOptionValue(args, i, value);
            delayMs = parseDelayMs(next.value);
            i = next.index;
            continue;
        }
        if (name === '--wait') {
            wait = true;
            continue;
        }
        if (name === '--no-wait') {
            wait = false;
            continue;
        }
        if (raw.startsWith('-')) {
            usage();
        }
        if (targetSet) {
            usage();
        }
        target = raw;
        targetSet = true;
    }

    return { target, count, delayMs, wait };
}

async function requireRuntimeAction(actionType) {
    const snap = await runtimeRef().get();
    const data = snap.exists ? snap.data() : {};
    if (!isRuntimeActive(data)) {
        throw new Error('bot runtime is not running');
    }
    if (!supportsRuntimeAction(data, actionType)) {
        throw new Error('bot runtime does not support burst actions; restart the bot runtime');
    }
    return data;
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
                username: lowerText(docSnap.data()?.username) || null,
            });
        }

        for (const docSnap of profilesSnap.docs) {
            if (targets.has(docSnap.id)) {
                continue;
            }

            targets.set(docSnap.id, {
                uid: docSnap.id,
                username: lowerText(docSnap.data()?.username) || null,
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
        username: lowerText(botSnap.data()?.username || profileSnap.data()?.username) || null,
    }];
}

async function deleteBotChats(chatPK) {
    if (!chatPK) {
        return 0;
    }

    const chats = await db.collection('chats').where('participants', 'array-contains', chatPK).get();
    for (const docSnap of chats.docs) {
        await db.recursiveDelete(docSnap.ref);
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
    const username = lowerText(botData?.username || profileData?.username || target.username);
    const chatPK = cleanText(botData?.chatPK || profileData?.chatPK);

    await setBotPowerState(target.uid, false).catch(() => {});

    const chatsDeleted = await deleteBotChats(chatPK);

    await Promise.all([
        db.recursiveDelete(usersRef).catch(() => {}),
        db.recursiveDelete(botRef).catch(() => {}),
        bucket.file(`${target.uid}/avatar.webp`).delete({ ignoreNotFound: true }).catch(() => {}),
    ]);

    const batch = db.batch();
    const deletedUsernames = new Set();

    batch.delete(profileRef);
    batch.delete(moderationRef);

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

export async function queueBurstAction(options = {}) {
    await requireRuntimeAction(BOT_ACTION_TYPE_BURST);

    const target = await resolveUid(options.target || DEFAULT_BURST_TARGET);
    const count = parseCount(options.count ?? BOT_BURST_DEFAULT_COUNT);
    const delayMs = parseDelayMs(options.delayMs ?? BOT_BURST_DEFAULT_DELAY_MS);
    const actionRef = runtimeRef().collection(BOT_RUNTIME_ACTIONS).doc();

    await actionRef.set({
        type: BOT_ACTION_TYPE_BURST,
        status: BOT_ACTION_STATUS_QUEUED,
        targetUid: target.uid,
        targetUsername: target.username || null,
        count,
        delayMs,
        requestedBy: 'cli',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    return {
        id: actionRef.id,
        ref: actionRef,
        target,
        count,
        delayMs,
    };
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
    console.log(`deleted ${plural(result.count, 'bot account')}, ${plural(chatsDeleted, 'chat')}, auth users, and bot seed entries${suffix}`);
}

function printBurstQueued(action) {
    const target = action.target.username ? `@${action.target.username}` : action.target.uid;
    console.log(`queued bot burst ${action.id}: ${plural(action.count, 'message')} to ${target} every ${msLabel(action.delayMs)}`);
}

function printBurstResult(data) {
    const result = data?.result || {};
    const sent = Number.isFinite(result.sent) ? result.sent : 0;
    const requested = Number.isFinite(result.requested) ? result.requested : data?.count;
    const botNames = Array.isArray(result.bots) ? result.bots.filter(Boolean).map((name) => `@${name}`).join(', ') : '';
    const botSuffix = botNames ? ` from ${botNames}` : '';
    const receipts = Number.isFinite(result.readReceipts) ? result.readReceipts : 0;
    const receiptSuffix = receipts ? ` and ${plural(receipts, 'read receipt')}` : '';
    console.log(`burst complete: sent ${sent}/${requested} messages${receiptSuffix}${botSuffix}`);
}

async function waitForAction(actionRef, timeoutMs) {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;

    while (Date.now() <= deadline) {
        const snap = await actionRef.get();
        if (!snap.exists) {
            throw new Error('bot burst action disappeared');
        }

        const data = snap.data();
        if (data?.status === BOT_ACTION_STATUS_DONE) {
            return data;
        }
        if (data?.status === BOT_ACTION_STATUS_ERROR) {
            throw new Error(data?.error || 'bot burst failed');
        }

        const runtimeSnap = await runtimeRef().get();
        if (!isRuntimeActive(runtimeSnap.exists ? runtimeSnap.data() : {})) {
            throw new Error('bot runtime stopped before burst finished');
        }

        await sleep(Math.min(BURST_WAIT_POLL_MS, Math.max(0, deadline - Date.now())));
    }

    throw new Error('bot burst did not finish before the wait timeout');
}

async function main() {
    const [action, arg1, arg2] = cliArgs();
    const cmd = lowerText(action);

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

    if (cmd === 'burst' || cmd === 'b') {
        const options = parseBurstArgs(cliArgs().slice(1));
        const action = await queueBurstAction(options);
        printBurstQueued(action);
        if (!options.wait) {
            return;
        }
        const result = await waitForAction(action.ref, action.count * action.delayMs + BURST_WAIT_GRACE_MS);
        printBurstResult(result);
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
