import admin, { db } from '../../functions/lib/admin.js';
import { normalizeUsername } from '../../functions/lib/regex.js';

export function cliArgs() {
    return process.argv.slice(2);
}

export async function resolveUid(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
        throw new Error('user required');
    }

    const lookup = raw.startsWith('@') ? raw.slice(1) : raw;

    const profileSnap = await db.collection('profiles').doc(lookup).get();
    if (profileSnap.exists) {
        return { uid: lookup, username: profileSnap.data()?.username || null };
    }

    if (!raw.startsWith('@')) {
        try {
            await admin.auth().getUser(raw);
            const resolvedProfileSnap = await db.collection('profiles').doc(raw).get();
            return { uid: raw, username: resolvedProfileSnap.data()?.username || null };
        } catch {}
    }

    const username = normalizeUsername(lookup);
    if (!username) {
        throw new Error('user not found');
    }

    const usernameSnap = await db.collection('usernames').doc(username).get();
    const uid = usernameSnap.data()?.uid;
    if (!uid) {
        throw new Error('user not found');
    }

    const resolvedProfileSnap = await db.collection('profiles').doc(uid).get();
    return {
        uid,
        username: resolvedProfileSnap.data()?.username || username,
    };
}
