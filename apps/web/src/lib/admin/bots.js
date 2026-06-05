import { cleanText, lowerText } from '@veyl/shared/utils/text';
import { timestampMs } from '@veyl/shared/utils/time';

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
