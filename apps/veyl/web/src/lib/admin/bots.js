import { deleteField, doc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { cleanText, lowerText } from '@veyl/shared/utils/text';
import { timestampMs } from '@veyl/shared/utils/time';
import { db, getFunctions, getStorage } from '@/lib/firebase/firebaseclient';
import { dropAvatar } from '@veyl/shared/files';

function botRank(bot) {
    const status = lowerText(bot?.status);
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

        const byRun = timestampMs(b?.lastRunAt, 0, { parseString: true }) - timestampMs(a?.lastRunAt, 0, { parseString: true });
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
