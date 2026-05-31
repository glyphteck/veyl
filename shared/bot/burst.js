import {
    BOT_BURST_DEFAULT_COUNT,
    BOT_BURST_DEFAULT_DELAY_MS,
    BOT_BURST_MAX_COUNT,
    BOT_BURST_MIN_DELAY_MS,
} from '../config.js';
import { lowerText } from '../utils/text.js';

export function cleanBurstCount(value, name = 'burst count') {
    const count = Number(value ?? BOT_BURST_DEFAULT_COUNT);
    if (!Number.isInteger(count) || count <= 0 || count > BOT_BURST_MAX_COUNT) {
        throw new Error(`${name} must be an integer from 1 to ${BOT_BURST_MAX_COUNT}`);
    }
    return count;
}

export function cleanBurstDelayMs(value, { name = 'burst delay', text = false } = {}) {
    const raw = value ?? BOT_BURST_DEFAULT_DELAY_MS;
    const delayMs = text ? parseDelayText(raw) : Number(raw);
    if (!Number.isFinite(delayMs) || delayMs < BOT_BURST_MIN_DELAY_MS) {
        throw new Error(`${name} must be at least ${BOT_BURST_MIN_DELAY_MS}ms`);
    }
    return Math.round(delayMs);
}

function parseDelayText(value) {
    const raw = lowerText(value);
    if (raw.endsWith('ms')) {
        return Number(raw.slice(0, -2));
    }
    if (raw.endsWith('s')) {
        return Number(raw.slice(0, -1)) * 1000;
    }
    return Number(raw);
}
