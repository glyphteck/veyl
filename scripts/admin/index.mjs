#!/usr/bin/env node

import { db } from '../../functions/lib/admin.js';
import { cliArgs, resolveUid } from './common.mjs';

function usage() {
    console.error('usage: pnpm admin <add|drop> <uid|@username>');
    process.exit(1);
}

async function addAdmin(uid) {
    await db.collection('admins').doc(uid).set({});
}

async function dropAdmin(uid) {
    await db.collection('admins').doc(uid).delete();
}

async function main() {
    const [action, userArg] = cliArgs();
    if (!action || !userArg) {
        usage();
    }

    const cmd = String(action).trim().toLowerCase();
    if (!['add', 'drop'].includes(cmd)) {
        usage();
    }

    const { uid, username } = await resolveUid(userArg);

    if (cmd === 'add') {
        await addAdmin(uid);
        console.log(`added admin ${username ? `@${username}` : uid} (${uid})`);
        return;
    }

    await dropAdmin(uid);
    console.log(`dropped admin ${username ? `@${username}` : uid} (${uid})`);
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
});
