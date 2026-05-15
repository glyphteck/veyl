#!/usr/bin/env node

import admin, { db } from '../../functions/lib/admin.js';
import { cliArgs } from './common.mjs';
import { nukeBots } from './bot.mjs';

const ALL = ['db', 'storage', 'auth'];
const EXTRA = ['bots'];
const KNOWN = [...ALL, ...EXTRA];

function usage() {
    console.error('usage: bun nuke <db|storage|auth|bots|all> [...]');
    console.error('usage: bun nuke bots [@username|uid]');
    process.exit(1);
}

function parseArgs(args) {
    if (!args.length) usage();

    const targets = new Set();
    let botTarget = 'all';

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const target = String(arg ?? '')
            .trim()
            .toLowerCase();

        if (!target) continue;
        if (target === 'all') {
            ALL.forEach((name) => targets.add(name));
            continue;
        }

        if (target === 'bots' || target === 'bot') {
            targets.add('bots');

            const maybeBot = String(args[index + 1] ?? '').trim();
            const maybeBotTarget = maybeBot.toLowerCase();
            if (maybeBot && !KNOWN.includes(maybeBotTarget) && maybeBotTarget !== 'bot') {
                botTarget = maybeBot;
                index += 1;
            }
            continue;
        }

        if (ALL.includes(target)) {
            targets.add(target);
            continue;
        }

        throw new Error(`unknown nuke target: ${target}`);
    }

    if (!targets.size) usage();
    return {
        targets: [...targets],
        botTarget,
    };
}

async function mapLimit(items, limit, mapper) {
    for (let i = 0; i < items.length; i += limit) {
        await Promise.all(items.slice(i, i + limit).map(mapper));
    }
}

async function nukeDb() {
    const deleted = [];
    let rounds = 0;

    while (rounds < 20) {
        const collections = await db.listCollections();
        if (!collections.length) break;

        rounds += 1;
        for (const collection of collections.sort((a, b) => a.id.localeCompare(b.id))) {
            await db.recursiveDelete(collection);
            deleted.push(collection.id);
        }
    }

    const remaining = await db.listCollections();
    if (remaining.length) {
        throw new Error(`db nuke did not finish, remaining collections: ${remaining.map((ref) => ref.id).join(', ')}`);
    }

    return {
        collections: deleted,
        rounds,
    };
}

async function nukeAuth() {
    let deleted = 0;
    let failed = 0;

    while (true) {
        const page = await admin.auth().listUsers(1000);
        if (!page.users.length) break;

        const result = await admin.auth().deleteUsers(page.users.map((user) => user.uid));
        deleted += result.successCount;
        failed += result.failureCount;

        if (page.users.length < 1000) break;
    }

    return { deleted, failed };
}

async function nukeStorage() {
    const bucket = admin.storage().bucket();
    let deleted = 0;

    while (true) {
        const [files] = await bucket.getFiles({ autoPaginate: false, maxResults: 1000 });
        if (!files.length) break;

        await mapLimit(files, 20, async (file) => {
            await file.delete({ ignoreNotFound: true });
            deleted += 1;
        });
    }

    return {
        bucket: bucket.name,
        deleted,
    };
}

const runners = {
    db: nukeDb,
    storage: nukeStorage,
    auth: nukeAuth,
    bots: nukeBots,
};

function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function printResult(target, result) {
    if (target === 'db') {
        const collections = [...new Set(result.collections)];
        const names = collections.length ? `: ${collections.join(', ')}` : '';
        console.log(`deleted ${plural(collections.length, 'collection')} from firestore in ${plural(result.rounds, 'round')}${names}`);
        return;
    }

    if (target === 'storage') {
        console.log(`deleted ${plural(result.deleted, 'object')} from storage bucket ${result.bucket}`);
        return;
    }

    if (target === 'auth') {
        const failed = result.failed ? `, ${result.failed} failed` : '';
        console.log(`deleted ${plural(result.deleted, 'auth user')}${failed}`);
        return;
    }

    if (target === 'bots') {
        const names = result.wiped.map((entry) => (entry.username ? `@${entry.username}` : entry.uid)).join(', ');
        const chatCount = result.wiped.reduce((sum, entry) => sum + (entry.chatsDeleted || 0), 0);
        const suffix = names ? `: ${names}` : '';
        console.log(`deleted ${plural(result.count, 'bot account')} and ${plural(chatCount, 'chat')}${suffix}`);
    }
}

async function main() {
    const { targets, botTarget } = parseArgs(cliArgs());

    for (const target of targets) {
        console.log(`nuking ${target}...`);
        const result = await (target === 'bots' ? runners[target](botTarget) : runners[target]());
        printResult(target, result);
    }

    console.log(`nuke complete: ${targets.join(', ')}`);
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
});
