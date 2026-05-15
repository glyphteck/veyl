import { deleteField, doc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, getFunctions, getStorage } from '@/lib/firebase/firebaseclient';
import { timestampMs } from './reports';
import { dropAvatar } from '@glyphteck/shared/files';

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function getBanUntilMs(ban) {
    if (!ban || typeof ban !== 'object' || Array.isArray(ban)) {
        return null;
    }

    if (ban.until == null) {
        return null;
    }

    if (typeof ban.until?.toMillis === 'function') {
        return ban.until.toMillis();
    }

    if (ban.until instanceof Date) {
        return ban.until.getTime();
    }

    const ms = Number(ban.until);
    return Number.isFinite(ms) ? ms : null;
}

export function getActiveBan(ban) {
    if (!ban || typeof ban !== 'object' || Array.isArray(ban)) {
        return null;
    }

    const untilMs = getBanUntilMs(ban);
    if (untilMs == null) {
        return ban;
    }

    return untilMs > Date.now() ? ban : null;
}

function botRank(bot) {
    const status = cleanText(bot?.status).toLowerCase();
    if (bot?.enabled) {
        if (status === 'booting') return 0;
        if (status === 'running') return 1;
        if (status === 'error') return 2;
        return 3;
    }
    if (status === 'error') return 4;
    return 5;
}

export function sortBots(rows = []) {
    return [...rows].sort((a, b) => {
        const byRank = botRank(a) - botRank(b);
        if (byRank) return byRank;

        const byRun = timestampMs(b?.lastRunAt) - timestampMs(a?.lastRunAt);
        if (byRun) return byRun;

        return cleanText(a?.id).localeCompare(cleanText(b?.id));
    });
}

export async function ban(uid, feature = 'chat') {
    await setDoc(
        doc(db, 'moderation', uid),
        { banned: { [feature]: { until: null } } },
        { merge: true }
    );

    if (feature === 'avatar') {
        await dropAvatar(getStorage(), uid).catch((error) => {
            if (error?.code !== 'storage/object-not-found') {
                throw error;
            }
        });
    }
}

export async function unban(uid, feature = 'chat') {
    await setDoc(
        doc(db, 'moderation', uid),
        { banned: { [feature]: deleteField() } },
        { merge: true }
    );
}

export async function powerBot(uid, enabled) {
    await httpsCallable(getFunctions(), 'setBotPower')({ botId: uid, enabled: !!enabled });
}
