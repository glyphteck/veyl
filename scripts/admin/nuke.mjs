#!/usr/bin/env bun

import admin, { db } from '../../functions/lib/admin.js';
import { cliArgs } from './cli.mjs';
import { nukeBots } from './bot.mjs';
import { uniqueValues } from '@veyl/shared/utils/array';
import { lowerText } from '@veyl/shared/utils/text';

const ALL = ['db', 'storage', 'auth'];
const EXTRA = ['chat', 'bots'];
const KNOWN = [...ALL, ...EXTRA];

const CHAT_ROOT_COLLECTIONS = Object.freeze([
    'chats',
    'links',
    'chatMedia',
    'mediaStays',
    'media_upload_reservations',
    'shared_media_upload_reservations',
]);

const USER_CHAT_SUBCOLLECTIONS = Object.freeze([
    'chats',
    'inbox',
    'savedMessages',
]);

const CHAT_STORAGE_PREFIXES = Object.freeze([
    'chat-media/',
    'shared/',
    'media/',
]);

function usage() {
    console.error('usage: bun nuke <db|storage|auth|chat|bots|all> [...]');
    console.error('usage: bun nuke chat');
    console.error('usage: bun nuke bots [@username|uid]');
    process.exit(1);
}

function parseArgs(args) {
    if (!args.length) usage();

    const targets = new Set();
    let botTarget = 'all';

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const target = lowerText(arg);

        if (!target) continue;
        if (target === 'all') {
            ALL.forEach((name) => targets.add(name));
            continue;
        }

        if (target === 'bots' || target === 'bot') {
            targets.add('bots');

            const maybeBot = String(args[index + 1] ?? '').trim();
            const maybeBotTarget = lowerText(maybeBot);
            if (maybeBot && !KNOWN.includes(maybeBotTarget) && maybeBotTarget !== 'bot') {
                botTarget = maybeBot;
                index += 1;
            }
            continue;
        }

        if (ALL.includes(target) || target === 'chat') {
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

function isMissingError(error) {
    return error?.code === 404
        || error?.code === 5
        || error?.errors?.some?.((item) => item?.reason === 'notFound');
}

async function recursiveDelete(ref) {
    await db.recursiveDelete(ref).catch((error) => {
        if (isMissingError(error) || /not found/i.test(String(error?.message || ''))) {
            return;
        }
        throw error;
    });
}

async function nukeDb() {
    const deleted = [];
    let rounds = 0;

    while (rounds < 20) {
        const collections = await db.listCollections();
        if (!collections.length) break;

        rounds += 1;
        for (const collection of collections.sort((a, b) => a.id.localeCompare(b.id))) {
            await recursiveDelete(collection);
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

async function deleteChatRootCollections() {
    const deleted = [];
    for (const name of CHAT_ROOT_COLLECTIONS) {
        await recursiveDelete(db.collection(name));
        deleted.push(name);
    }
    return deleted;
}

async function deleteUserChatState() {
    const users = await db.collection('users').listDocuments();
    let deleted = 0;

    for (const userRef of users) {
        for (const name of USER_CHAT_SUBCOLLECTIONS) {
            await recursiveDelete(userRef.collection(name));
            deleted += 1;
        }
    }

    return { users: users.length, subcollections: deleted };
}

async function deleteStoragePrefix(bucket, prefix) {
    let deleted = 0;

    while (true) {
        const [files] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: 1000 });
        if (!files.length) return deleted;

        await mapLimit(files, 20, async (file) => {
            await file.setMetadata({ temporaryHold: false }).catch((error) => {
                if (isMissingError(error)) return;
                throw error;
            });
            await file.delete({ ignoreNotFound: true }).catch((error) => {
                if (isMissingError(error)) return;
                throw error;
            });
            deleted += 1;
        });
    }
}

async function deleteChatStorage() {
    const bucket = admin.storage().bucket();
    const prefixes = [];

    for (const prefix of CHAT_STORAGE_PREFIXES) {
        prefixes.push({ prefix, deleted: await deleteStoragePrefix(bucket, prefix) });
    }

    return { bucket: bucket.name, prefixes };
}

async function nukeChat() {
    const roots = await deleteChatRootCollections();
    const users = await deleteUserChatState();
    const storage = await deleteChatStorage();

    return {
        rootCollections: roots,
        users,
        storage,
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
    chat: nukeChat,
    bots: nukeBots,
};

function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function printResult(target, result) {
    if (target === 'db') {
        const collections = uniqueValues(result.collections);
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

    if (target === 'chat') {
        const roots = result.rootCollections.join(', ');
        const storage = result.storage.prefixes.map((item) => `${item.prefix}${item.deleted}`).join(', ');
        console.log(`deleted chat root collections: ${roots}`);
        console.log(`deleted ${plural(result.users.subcollections, 'user chat subcollection')} across ${plural(result.users.users, 'user')}`);
        console.log(`deleted chat storage objects from ${result.storage.bucket}: ${storage}`);
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
