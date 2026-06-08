import { getMessageOrderMs } from '../state.js';
import { formatDayLabel, localDayKey, localDayStartMs } from '../../utils/time.js';
import { DATE_SEPARATOR_MSG_TYPE } from './types.js';

function messageDay(message) {
    const ms = getMessageOrderMs(message);
    if (!Number.isFinite(ms)) {
        return null;
    }
    const key = localDayKey(ms);
    return key ? { key, ms } : null;
}

function makeDateSeparator(ms) {
    const startMs = localDayStartMs(ms);
    return {
        t: DATE_SEPARATOR_MSG_TYPE,
        cid: `local:day:${localDayKey(ms)}`,
        ts: Number.isFinite(startMs) ? startMs : ms,
    };
}

export function isDateSeparatorMsg(msg) {
    return msg?.t === DATE_SEPARATOR_MSG_TYPE && !!getDateSeparatorText(msg);
}

export function getDateSeparatorText(msg) {
    if (msg?.t !== DATE_SEPARATOR_MSG_TYPE) {
        return '';
    }
    return formatDayLabel(msg.ts);
}

export function withDateSeparators(messages) {
    if (!Array.isArray(messages) || !messages.length) {
        return messages || [];
    }

    let previousDay = null;
    let changed = false;
    const next = [];

    for (const msg of messages) {
        const current = messageDay(msg);
        if (isDateSeparatorMsg(msg)) {
            next.push(msg);
            if (current?.key) {
                previousDay = current.key;
            }
            continue;
        }
        if (current?.key && current.key !== previousDay) {
            next.push(makeDateSeparator(current.ms));
            changed = true;
        }
        next.push(msg);
        if (current?.key) {
            previousDay = current.key;
        }
    }

    return changed ? next : messages;
}
