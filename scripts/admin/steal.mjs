#!/usr/bin/env bun

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import admin, { db } from '../../functions/lib/admin.js';
import { MAX_USERNAME, isUsername, normalizeUsername } from '../../functions/lib/regex.js';
import { cliArgs } from './common.mjs';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function usage() {
    console.error('usage: bun steal <@username>');
    process.exit(1);
}

function cleanInput(value) {
    return normalizeUsername(String(value ?? '').trim().replace(/^@/, ''));
}

function randomUsername() {
    const bytes = randomBytes(MAX_USERNAME);
    let name = '';
    for (let i = 0; i < MAX_USERNAME; i++) {
        name += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return name;
}

async function randomOpenUsername(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
        const username = randomUsername();
        const snap = await db.collection('usernames').doc(username).get();
        if (!snap.exists) {
            return username;
        }
    }
    throw new Error('could not generate unique username');
}

async function moveUsername(target, replacement) {
    const targetRef = db.collection('usernames').doc(target);
    const replacementRef = db.collection('usernames').doc(replacement);

    return db.runTransaction(async (tx) => {
        const [targetSnap, replacementSnap] = await Promise.all([tx.get(targetRef), tx.get(replacementRef)]);
        const uid = String(targetSnap.data()?.uid || '').trim();
        if (!uid) {
            throw new Error(`@${target} is not reserved`);
        }
        if (replacementSnap.exists) {
            const error = new Error('replacement username collision');
            error.code = 'collision';
            throw error;
        }

        const profileRef = db.collection('profiles').doc(uid);
        const botRef = db.collection('bots').doc(uid);
        const [profileSnap, botSnap] = await Promise.all([tx.get(profileRef), tx.get(botRef)]);

        tx.delete(targetRef);
        tx.set(replacementRef, { uid });
        tx.set(profileRef, { username: replacement }, { merge: true });

        if (botSnap.exists) {
            tx.set(botRef, { username: replacement }, { merge: true });
        }

        return {
            uid,
            previous: profileSnap.data()?.username || target,
            replacement,
        };
    });
}

export async function stealUsername(rawTarget) {
    const target = cleanInput(rawTarget);
    if (!isUsername(target)) {
        throw new Error(`invalid username: ${rawTarget}`);
    }

    for (let i = 0; i < 10; i++) {
        const replacement = await randomOpenUsername();
        try {
            const result = await moveUsername(target, replacement);
            await admin.auth().updateUser(result.uid, { displayName: `@${replacement}` }).catch((error) => {
                if (error?.code !== 'auth/user-not-found') {
                    console.warn(`warning: username moved, but auth displayName update failed for ${result.uid}: ${error?.message || error}`);
                }
            });
            return result;
        } catch (error) {
            if (error?.code === 'collision') {
                continue;
            }
            throw error;
        }
    }

    throw new Error('could not steal username');
}

async function main() {
    const [target] = cliArgs();
    if (!target) {
        usage();
    }

    const result = await stealUsername(target);
    console.log(`freed @${cleanInput(target)} by renaming ${result.uid} from @${result.previous} to @${result.replacement}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error?.message || error);
        process.exit(1);
    });
}
