#!/usr/bin/env bun

import { fileURLToPath } from 'node:url';
import admin, { db, FieldValue, projectId } from '../../functions/lib/admin.js';
import {
    BOT_ACTION_STATUS_DONE,
    BOT_ACTION_STATUS_ERROR,
    BOT_ACTION_STATUS_CANCELLED,
    BOT_ACTION_STATUS_QUEUED,
    BOT_ACTION_STATUS_RUNNING,
    BOT_ACTION_TYPE_TRAFFIC_MSG,
    BOT_ACTION_TYPE_TRAFFIC_FUND,
    BOT_ACTION_TYPE_TRAFFIC_TX,
    BOT_MODE,
    BOT_RUNTIME_ACTIONS,
    BOT_RUNTIME_DOC_ID,
    BOT_RUNTIME_LEASE_MS,
} from '@veyl/shared/bot/events';
import { BOT_TRAFFIC_GROUP, botTrafficGroups, cleanTrafficCount, cleanTrafficDelayMs } from '@veyl/shared/bot/traffic';
import { BOT_TRAFFIC_TRANSFER_AMOUNT_SATS } from '@veyl/shared/bot/traffic/transfers';
import {
    BOT_TRAFFIC_DEFAULT_COUNT,
    BOT_TRAFFIC_DEFAULT_DELAY_MS,
    BOT_TRAFFIC_FAST_DELAY_MS,
    BOT_TRAFFIC_SLOW_DELAY_MS,
} from '@veyl/shared/config';
import { resolveBotUid, setBotPowerState } from '../../functions/lib/bots.js';
import { provisionBot } from '../../apps/bot/src/newbot.js';
import { createSecretClient, deleteBotSeed } from '../../apps/bot/src/secrets.js';
import { cliArgs, resolveUid } from './cli.mjs';
import { timestampMs } from '@veyl/shared/utils/time';
import { sleep } from '@veyl/shared/utils/async';
import { cleanText, lowerText, sameText } from '@veyl/shared/utils/text';

const DEFAULT_TRAFFIC_TARGET = '@zxrl';
const DEFAULT_FUND_BOT_AMOUNT_SATS = 1000;
const DEFAULT_FUND_BOT_SOURCE = '@review';
const REVIEW_BOT_USERNAME = DEFAULT_FUND_BOT_SOURCE.replace(/^@/, '');
const TRAFFIC_WAIT_POLL_MS = 2000;
const TRAFFIC_WAIT_GRACE_MS = 60000;
const TRAFFIC_WAIT_SEND_GRACE_MS = 2500;
const TRAFFIC_SPEEDS = Object.freeze({
    fast: BOT_TRAFFIC_FAST_DELAY_MS,
    slow: BOT_TRAFFIC_SLOW_DELAY_MS,
});

function usage() {
    console.error('usage: bun bot add [username|count]');
    console.error('usage: bun bot power <@username|uid|all> <on|off>');
    console.error('usage: bun bot kill <@username|uid|all>');
    console.error('usage: bun bot traffic [mixed/tx/msg] [@username/uid] [fast/slow] [--count 60] [--duration 10m] [--delay 3s] [--no-wait]');
    console.error('usage: bun bot traffic msg [@username/uid] [fast/slow] [--solo] [--source @botname]');
    console.error('usage: bun bot traffic fund [--source @review] [--target 1000] [--amount 1000] [--delay 250ms] [--no-wait]');
    console.error('usage: bun bot traffic label [@username|uid|all] [on|off]');
    console.error('usage: bun bot traffic stop');
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
    return cleanTrafficCount(value, 'count');
}

function parseDelayMs(value) {
    return cleanTrafficDelayMs(value, { name: 'delay', text: true });
}

function parseDurationMs(value) {
    return cleanTrafficDelayMs(value, { name: 'duration', text: true });
}

function countFromDuration(durationMs, delayMs) {
    return parseCount(Math.max(1, Math.ceil(durationMs / delayMs)));
}

function parseAmountSats(value, fallback) {
    const amount = Number(value ?? fallback);
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('amount must be a positive integer sat amount');
    }
    return amount;
}

function defaultTrafficGroupForUsername(username) {
    return !sameText(username, REVIEW_BOT_USERNAME);
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

function trafficSpeedDelayMs(value) {
    return TRAFFIC_SPEEDS[lowerText(value)] || null;
}

function parseTrafficLoadArgs(args, { allowSolo = false } = {}) {
    let target = DEFAULT_TRAFFIC_TARGET;
    let targetSet = false;
    let count = BOT_TRAFFIC_DEFAULT_COUNT;
    let countSet = false;
    let durationMs = null;
    let delayMs = BOT_TRAFFIC_DEFAULT_DELAY_MS;
    let delaySet = false;
    let speed = null;
    let source = null;
    let solo = false;
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
            countSet = true;
            i = next.index;
            continue;
        }
        if (name === '--duration' || name === '--duration-ms') {
            const next = readOptionValue(args, i, value);
            durationMs = parseDurationMs(next.value);
            i = next.index;
            continue;
        }
        if (name === '--delay' || name === '--delay-ms' || name === '-d') {
            const next = readOptionValue(args, i, value);
            delayMs = parseDelayMs(next.value);
            delaySet = true;
            i = next.index;
            continue;
        }
        if (allowSolo && name === '--solo') {
            solo = true;
            continue;
        }
        if (allowSolo && (name === '--source' || name === '--from' || name === '-s')) {
            const next = readOptionValue(args, i, value);
            source = next.value;
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
        const speedDelayMs = trafficSpeedDelayMs(raw);
        if (speedDelayMs != null) {
            speed = lowerText(raw);
            if (!delaySet) {
                delayMs = speedDelayMs;
            }
            continue;
        }
        if (targetSet) {
            usage();
        }
        target = raw;
        targetSet = true;
    }

    if (countSet && durationMs != null) {
        usage();
    }
    if (source && !solo) {
        usage();
    }
    if (durationMs != null) {
        count = countFromDuration(durationMs, delayMs);
    }

    return { target, count, delayMs, durationMs, wait, speed, source, solo };
}

function parseFundBotsArgs(args) {
    let amountSats = DEFAULT_FUND_BOT_AMOUNT_SATS;
    let source = DEFAULT_FUND_BOT_SOURCE;
    let delayMs = 250;
    let wait = true;

    for (let i = 0; i < args.length; i++) {
        const raw = String(args[i] ?? '').trim();
        if (!raw) {
            continue;
        }

        const { name, value } = splitOption(raw);
        if (name === '--target' || name === '--amount' || name === '--amount-sats' || name === '-a') {
            const next = readOptionValue(args, i, value);
            amountSats = parseAmountSats(next.value, DEFAULT_FUND_BOT_AMOUNT_SATS);
            i = next.index;
            continue;
        }
        if (name === '--source' || name === '--from' || name === '-s') {
            const next = readOptionValue(args, i, value);
            source = next.value;
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
        usage();
    }

    return { amountSats, source, delayMs, wait };
}

async function requireRuntimeAction(actionType) {
    const snap = await runtimeRef().get();
    const data = snap.exists ? snap.data() : {};
    if (!isRuntimeActive(data)) {
        throw new Error('bot runtime is not running');
    }
    if (!supportsRuntimeAction(data, actionType)) {
        throw new Error(`bot runtime does not support ${actionType} actions; restart the bot runtime`);
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

async function resolveBotIdentity(target, label = 'bot') {
    const raw = cleanText(target || '');
    const id = lowerText(raw.replace(/^@/, ''));
    const uid = await resolveBotUid(id);
    if (!uid) {
        throw new Error(`${label} not found: ${target}`);
    }

    const [botSnap, profileSnap] = await Promise.all([
        db.collection('bots').doc(uid).get(),
        db.collection('profiles').doc(uid).get(),
    ]);

    return {
        uid,
        username: lowerText(botSnap.data()?.username || profileSnap.data()?.username) || null,
    };
}

function parseTrafficCommand(args) {
    const first = lowerText(args[0]);
    if (!first) {
        return { mode: 'mixed', args: [] };
    }
    if (first === 'mixed') {
        return { mode: 'mixed', args: args.slice(1) };
    }
    if (first === 'msg') {
        return { mode: 'msg', args: args.slice(1) };
    }
    if (first === 'tx') {
        return { mode: 'tx', args: args.slice(1) };
    }
    if (first === 'fund') {
        return { mode: 'fund', args: args.slice(1) };
    }
    if (first === 'label' || first === 'group') {
        return { mode: 'label', args: args.slice(1) };
    }
    if (first === 'stop') {
        if (args.length > 1) {
            usage();
        }
        return { mode: 'stop', args: [] };
    }

    return { mode: 'mixed', args };
}

function parseTrafficLabelArgs(args) {
    if (args.length > 2) {
        usage();
    }

    const enabled = args[1] == null ? null : normalizePower(args[1]);
    if (args[1] != null && enabled == null) {
        usage();
    }

    return {
        target: args[0] || 'all',
        enabled,
    };
}

async function deleteBotChats(chatPK) {
    // Opaque canonical chat docs cannot be discovered from a bot chat key.
    return 0;
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

export async function labelTrafficBots(target = 'all', enabled = null) {
    const targets = await resolveBotTargets(target);
    const labelled = [];

    for (const entry of targets) {
        const botRef = db.collection('bots').doc(entry.uid);
        const profileRef = db.collection('profiles').doc(entry.uid);
        const [botSnap, profileSnap] = await Promise.all([botRef.get(), profileRef.get()]);
        const username = lowerText(botSnap.data()?.username || profileSnap.data()?.username || entry.username);
        const traffic = enabled == null ? defaultTrafficGroupForUsername(username) : enabled;
        await botRef.set(
            {
                groups: botTrafficGroups({ traffic }),
            },
            { merge: true }
        );
        labelled.push({ uid: entry.uid, username, traffic });
    }

    return {
        count: labelled.length,
        group: BOT_TRAFFIC_GROUP,
        labelled,
    };
}

export async function queueTrafficMessageAction(options = {}) {
    await requireRuntimeAction(BOT_ACTION_TYPE_TRAFFIC_MSG);

    const target = await resolveUid(options.target || DEFAULT_TRAFFIC_TARGET);
    const source = options.source ? await resolveBotIdentity(options.source, 'traffic source bot') : null;
    const count = parseCount(options.count ?? BOT_TRAFFIC_DEFAULT_COUNT);
    const delayMs = parseDelayMs(options.delayMs ?? BOT_TRAFFIC_DEFAULT_DELAY_MS);
    const actionRef = runtimeRef().collection(BOT_RUNTIME_ACTIONS).doc();

    await actionRef.set({
        type: BOT_ACTION_TYPE_TRAFFIC_MSG,
        status: BOT_ACTION_STATUS_QUEUED,
        targetUid: target.uid,
        targetUsername: target.username || null,
        sourceUid: source?.uid || null,
        sourceUsername: source?.username || null,
        trafficGroup: BOT_TRAFFIC_GROUP,
        solo: options.solo === true,
        count,
        delayMs,
        durationMs: Number.isFinite(options.durationMs) ? options.durationMs : null,
        speed: options.speed || null,
        requestedBy: 'cli',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    return {
        id: actionRef.id,
        ref: actionRef,
        target,
        source,
        solo: options.solo === true,
        count,
        delayMs,
        durationMs: Number.isFinite(options.durationMs) ? options.durationMs : null,
        speed: options.speed || null,
    };
}

export async function queueTrafficFundAction(options = {}) {
    await requireRuntimeAction(BOT_ACTION_TYPE_TRAFFIC_FUND);

    const amountSats = parseAmountSats(options.amountSats ?? DEFAULT_FUND_BOT_AMOUNT_SATS, DEFAULT_FUND_BOT_AMOUNT_SATS);
    const source = await resolveBotIdentity(options.source || DEFAULT_FUND_BOT_SOURCE, 'funding bot');
    const delayMs = parseDelayMs(options.delayMs ?? 250);
    const actionRef = runtimeRef().collection(BOT_RUNTIME_ACTIONS).doc();

    await actionRef.set({
        type: BOT_ACTION_TYPE_TRAFFIC_FUND,
        status: BOT_ACTION_STATUS_QUEUED,
        amountSats,
        sourceUid: source.uid,
        sourceUsername: source.username || null,
        trafficGroup: BOT_TRAFFIC_GROUP,
        delayMs,
        requestedBy: 'cli',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    return {
        id: actionRef.id,
        ref: actionRef,
        amountSats,
        source,
        delayMs,
    };
}

export async function queueTrafficTransferAction(options = {}) {
    await requireRuntimeAction(BOT_ACTION_TYPE_TRAFFIC_TX);

    const target = await resolveUid(options.target || DEFAULT_TRAFFIC_TARGET);
    const count = parseCount(options.count ?? BOT_TRAFFIC_DEFAULT_COUNT);
    const delayMs = parseDelayMs(options.delayMs ?? BOT_TRAFFIC_DEFAULT_DELAY_MS);
    const amountSats = BOT_TRAFFIC_TRANSFER_AMOUNT_SATS;
    const actionRef = runtimeRef().collection(BOT_RUNTIME_ACTIONS).doc();

    await actionRef.set({
        type: BOT_ACTION_TYPE_TRAFFIC_TX,
        status: BOT_ACTION_STATUS_QUEUED,
        targetUid: target.uid,
        targetUsername: target.username || null,
        count,
        delayMs,
        durationMs: Number.isFinite(options.durationMs) ? options.durationMs : null,
        amountSats,
        trafficGroup: BOT_TRAFFIC_GROUP,
        speed: options.speed || null,
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
        durationMs: Number.isFinite(options.durationMs) ? options.durationMs : null,
        amountSats,
        speed: options.speed || null,
    };
}

export async function queueTrafficMixedActions(options = {}) {
    await requireRuntimeAction(BOT_ACTION_TYPE_TRAFFIC_MSG);
    await requireRuntimeAction(BOT_ACTION_TYPE_TRAFFIC_TX);

    const [message, transfer] = await Promise.all([
        queueTrafficMessageAction(options),
        queueTrafficTransferAction(options),
    ]);

    return {
        mode: 'mixed',
        message,
        transfer,
        target: message.target,
        count: message.count,
        delayMs: message.delayMs,
        durationMs: message.durationMs,
        speed: message.speed || null,
    };
}

export async function stopTrafficActions() {
    const snap = await runtimeRef().collection(BOT_RUNTIME_ACTIONS).where('status', 'in', [BOT_ACTION_STATUS_QUEUED, BOT_ACTION_STATUS_RUNNING]).get();
    const batch = db.batch();
    let queued = 0;
    let running = 0;

    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (![BOT_ACTION_TYPE_TRAFFIC_MSG, BOT_ACTION_TYPE_TRAFFIC_FUND, BOT_ACTION_TYPE_TRAFFIC_TX].includes(data?.type)) {
            continue;
        }

        if (data?.status === BOT_ACTION_STATUS_QUEUED) {
            queued++;
            batch.set(
                docSnap.ref,
                {
                    status: BOT_ACTION_STATUS_CANCELLED,
                    result: {
                        type: data?.type || BOT_ACTION_TYPE_TRAFFIC_MSG,
                        requested: Number.isFinite(data?.count) ? data.count : 0,
                        sent: 0,
                        cancelled: true,
                        targetUid: data?.targetUid || null,
                        targetUsername: data?.targetUsername || null,
                        sourceUid: data?.sourceUid || null,
                        sourceUsername: data?.sourceUsername || null,
                        amountSats: Number.isFinite(data?.amountSats) ? data.amountSats : null,
                        delayMs: Number.isFinite(data?.delayMs) ? data.delayMs : 0,
                        durationMs: Number.isFinite(data?.durationMs) ? data.durationMs : null,
                        errors: 0,
                        errorMessages: [],
                    },
                    cancelRequested: true,
                    cancelRequestedAt: FieldValue.serverTimestamp(),
                    finishedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );
            continue;
        }

        running++;
        batch.set(
            docSnap.ref,
            {
                cancelRequested: true,
                cancelRequestedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    }

    const total = queued + running;
    if (total) {
        await batch.commit();
    }

    return { total, queued, running };
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

function printTrafficMessageQueued(action) {
    const target = action.target.username ? `@${action.target.username}` : action.target.uid;
    const duration = Number.isFinite(action.durationMs) ? ` for ${msLabel(action.durationMs)}` : '';
    const source = action.source?.username ? ` from @${action.source.username}` : '';
    const mode = action.solo ? 'solo traffic' : 'message traffic';
    console.log(`queued ${mode} ${action.id}: ${plural(action.count, 'message')} to ${target}${source} every ${msLabel(action.delayMs)}${duration}`);
}

function printTrafficFundQueued(action) {
    const source = action.source?.username ? `@${action.source.username}` : action.source?.uid || DEFAULT_FUND_BOT_SOURCE;
    console.log(`queued traffic funding ${action.id}: ${action.amountSats} sats from ${source} to each traffic bot every ${msLabel(action.delayMs)}`);
}

function printTrafficTransferQueued(action) {
    const target = action.target.username ? `@${action.target.username}` : action.target.uid;
    const duration = Number.isFinite(action.durationMs) ? ` for ${msLabel(action.durationMs)}` : '';
    console.log(`queued transfer traffic ${action.id}: ${plural(action.count, 'transfer')} of ${action.amountSats} sats to ${target} every ${msLabel(action.delayMs)}${duration}`);
}

function printTrafficMixedQueued(action) {
    const target = action.target.username ? `@${action.target.username}` : action.target.uid;
    const duration = Number.isFinite(action.durationMs) ? ` for ${msLabel(action.durationMs)}` : '';
    console.log(`queued mixed traffic ${action.message.id}, ${action.transfer.id}: ${plural(action.count, 'message')} and ${plural(action.count, 'transfer')} to ${target} every ${msLabel(action.delayMs)}${duration}`);
}

function senderCountsLabel(result) {
    const counts = result?.senderCounts;
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
        return '';
    }

    return Object.entries(counts)
        .filter(([, count]) => Number(count) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
        .map(([name, count]) => `@${name}x${count}`)
        .join(', ');
}

function failureSuffix(result) {
    const errors = Number.isFinite(result?.errors) ? result.errors : 0;
    return errors ? `, ${plural(errors, 'failure')}` : '';
}

function printTrafficMessageResult(data) {
    const result = data?.result || {};
    const sent = Number.isFinite(result.sent) ? result.sent : 0;
    const requested = Number.isFinite(result.requested) ? result.requested : data?.count;
    const botNames = senderCountsLabel(result) || (Array.isArray(result.bots) ? result.bots.filter(Boolean).map((name) => `@${name}`).join(', ') : '');
    const botSuffix = botNames ? ` from ${botNames}` : '';
    const requests = Number.isFinite(result.requests) ? result.requests : 0;
    const requestSuffix = requests ? ` including ${plural(requests, 'request')}` : '';
    const receipts = Number.isFinite(result.readReceipts) ? result.readReceipts : 0;
    const receiptSuffix = receipts ? ` and ${plural(receipts, 'read receipt')}` : '';
    const label = result.cancelled || data?.status === BOT_ACTION_STATUS_CANCELLED ? 'message traffic stopped' : 'message traffic complete';
    console.log(`${label}: sent ${sent}/${requested} messages${requestSuffix}${receiptSuffix}${botSuffix}${failureSuffix(result)}`);
}

function printTrafficFundResult(data) {
    const result = data?.result || {};
    const sent = Number.isFinite(result.sent) ? result.sent : 0;
    const requested = Number.isFinite(result.requested) ? result.requested : 0;
    const amount = Number.isFinite(result.amountSats) ? result.amountSats : data?.amountSats;
    const source = result.sourceUsername ? `@${result.sourceUsername}` : result.sourceUid || data?.sourceUsername || DEFAULT_FUND_BOT_SOURCE;
    const label = result.cancelled || data?.status === BOT_ACTION_STATUS_CANCELLED ? 'traffic funding stopped' : 'traffic funding complete';
    console.log(`${label}: sent ${sent}/${requested} funding transfers of ${amount} sats from ${source}${failureSuffix(result)}`);
}

function printTrafficTransferResult(data) {
    const result = data?.result || {};
    const sent = Number.isFinite(result.sent) ? result.sent : 0;
    const requested = Number.isFinite(result.requested) ? result.requested : data?.count;
    const botNames = senderCountsLabel(result) || (Array.isArray(result.bots) ? result.bots.filter(Boolean).map((name) => `@${name}`).join(', ') : '');
    const botSuffix = botNames ? ` from ${botNames}` : '';
    const amount = Number.isFinite(result.amountSats) ? result.amountSats : data?.amountSats;
    const label = result.cancelled || data?.status === BOT_ACTION_STATUS_CANCELLED ? 'transfer traffic stopped' : 'transfer traffic complete';
    console.log(`${label}: sent ${sent}/${requested} transfers of ${amount} sats${botSuffix}${failureSuffix(result)}`);
}

function printTrafficMixedResult(messageData, transferData) {
    printTrafficMessageResult(messageData);
    printTrafficTransferResult(transferData);
}

function printTrafficStopResult(result) {
    if (!result.total) {
        console.log('no active bot actions');
        return;
    }
    const queued = result.queued ? `${plural(result.queued, 'queued traffic action')}` : '';
    const running = result.running ? `${plural(result.running, 'running traffic action')}` : '';
    const details = [queued, running].filter(Boolean).join(', ');
    console.log(`requested stop for ${plural(result.total, 'bot action')}${details ? `: ${details}` : ''}`);
}

function printTrafficLabelResult(result) {
    const on = result.labelled.filter((entry) => entry.traffic).length;
    const off = result.labelled.length - on;
    console.log(`labelled ${plural(result.count, 'bot')} for ${result.group}: ${on} on, ${off} off`);
}

async function waitForAction(actionRef, timeoutMs) {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;

    while (Date.now() <= deadline) {
        const snap = await actionRef.get();
        if (!snap.exists) {
            throw new Error('bot action disappeared');
        }

        const data = snap.data();
        if (data?.status === BOT_ACTION_STATUS_DONE) {
            return data;
        }
        if (data?.status === BOT_ACTION_STATUS_ERROR) {
            throw new Error(data?.error || 'bot action failed');
        }
        if (data?.status === BOT_ACTION_STATUS_CANCELLED) {
            return data;
        }

        const runtimeSnap = await runtimeRef().get();
        if (!isRuntimeActive(runtimeSnap.exists ? runtimeSnap.data() : {})) {
            throw new Error('bot runtime stopped before action finished');
        }

        await sleep(Math.min(TRAFFIC_WAIT_POLL_MS, Math.max(0, deadline - Date.now())));
    }

    throw new Error('bot action did not finish before the wait timeout');
}

function trafficWaitTimeoutMs(action) {
    const count = Number.isFinite(action?.count) ? action.count : BOT_TRAFFIC_DEFAULT_COUNT;
    const delayMs = Number.isFinite(action?.delayMs) ? action.delayMs : BOT_TRAFFIC_DEFAULT_DELAY_MS;
    return count * (delayMs + TRAFFIC_WAIT_SEND_GRACE_MS) + TRAFFIC_WAIT_GRACE_MS;
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

    if (cmd === 'traffic') {
        const traffic = parseTrafficCommand(cliArgs().slice(1));
        if (traffic.mode === 'stop') {
            const result = await stopTrafficActions();
            printTrafficStopResult(result);
            return;
        }

        if (traffic.mode === 'fund') {
            const options = parseFundBotsArgs(traffic.args);
            const action = await queueTrafficFundAction(options);
            printTrafficFundQueued(action);
            if (!options.wait) {
                return;
            }
            const result = await waitForAction(action.ref, 300000);
            printTrafficFundResult(result);
            return;
        }

        if (traffic.mode === 'label') {
            const options = parseTrafficLabelArgs(traffic.args);
            const result = await labelTrafficBots(options.target, options.enabled);
            printTrafficLabelResult(result);
            return;
        }

        if (traffic.mode === 'tx') {
            const options = parseTrafficLoadArgs(traffic.args);
            const action = await queueTrafficTransferAction(options);
            printTrafficTransferQueued(action);
            if (!options.wait) {
                return;
            }
            const result = await waitForAction(action.ref, trafficWaitTimeoutMs(action));
            printTrafficTransferResult(result);
            return;
        }

        if (traffic.mode === 'mixed') {
            const options = parseTrafficLoadArgs(traffic.args);
            const action = await queueTrafficMixedActions(options);
            printTrafficMixedQueued(action);
            if (!options.wait) {
                return;
            }
            const [messageResult, transferResult] = await Promise.all([
                waitForAction(action.message.ref, trafficWaitTimeoutMs(action.message)),
                waitForAction(action.transfer.ref, trafficWaitTimeoutMs(action.transfer)),
            ]);
            printTrafficMixedResult(messageResult, transferResult);
            return;
        }

        const options = parseTrafficLoadArgs(traffic.args, { allowSolo: true });
        const action = await queueTrafficMessageAction(options);
        printTrafficMessageQueued(action);
        if (!options.wait) {
            return;
        }
        const result = await waitForAction(action.ref, trafficWaitTimeoutMs(action));
        printTrafficMessageResult(result);
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
