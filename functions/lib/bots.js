import { db, FieldValue } from './admin.js';

export async function isAdminUid(uid) {
    if (!uid) {
        return false;
    }

    const snap = await db.collection('admins').doc(uid).get();
    return snap.exists;
}

export async function resolveBotUid(identifier) {
    const raw = String(identifier ?? '').trim();
    if (!raw) {
        return null;
    }

    const botSnap = await db.collection('bots').doc(raw).get();
    if (botSnap.exists) {
        return raw;
    }

    const username = raw.toLowerCase();
    const byUsername = await db.collection('bots').where('username', '==', username).limit(1).get();
    if (!byUsername.empty) {
        return byUsername.docs[0].id;
    }

    const usernameSnap = await db.collection('usernames').doc(username).get();
    const uid = typeof usernameSnap.data()?.uid === 'string' ? usernameSnap.data().uid.trim() : '';
    if (uid) {
        const check = await db.collection('bots').doc(uid).get();
        if (check.exists) {
            return uid;
        }
    }

    return null;
}

export async function setBotPowerState(identifier, enabled) {
    const botUid = await resolveBotUid(identifier);
    if (!botUid) {
        throw new Error('bot not found');
    }

    const botRef = db.collection('bots').doc(botUid);
    const profileRef = db.collection('profiles').doc(botUid);

    if (enabled) {
        await Promise.all([
            botRef.set(
                {
                    enabled: true,
                    status: 'booting',
                    lastError: null,
                    resumeAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            ),
            profileRef.set({ active: true }, { merge: true }),
        ]);
        return botUid;
    }

    await Promise.all([
        botRef.set(
            {
                enabled: false,
                status: 'off',
                lastError: null,
            },
            { merge: true }
        ),
        profileRef.set({ active: false }, { merge: true }),
    ]);
    return botUid;
}
