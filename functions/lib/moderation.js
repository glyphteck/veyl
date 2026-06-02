import { db } from './admin.js';

export async function isChatBanned(uid) {
    if (!uid) {
        return false;
    }

    const snap = await db.collection('moderation').doc(uid).get();
    const banned = snap.data()?.banned;
    const activeBan = banned?.full || banned?.chat;
    if (!activeBan || typeof activeBan !== 'object') {
        return false;
    }

    if (activeBan.until == null) {
        return true;
    }

    const untilMs = typeof activeBan.until?.toMillis === 'function' ? activeBan.until.toMillis() : Number(activeBan.until);
    return Number.isFinite(untilMs) && untilMs > Date.now();
}
