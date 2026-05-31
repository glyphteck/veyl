import {
    BOT_BURST_DEFAULT_COUNT,
    BOT_BURST_DEFAULT_DELAY_MS,
    BOT_BURST_MAX_COUNT,
    BOT_BURST_MIN_DELAY_MS,
} from '../config.js';
import { lowerText } from '../utils/text.js';

export const BOT_BURST_EXCLUDED_USERNAMES = Object.freeze(['review']);
export const BOT_BURST_TEXT_WEIGHT = 85;
export const BOT_BURST_REQUEST_WEIGHT = 15;
export const BOT_BURST_REQUEST_MIN_SATS = 1000;
export const BOT_BURST_REQUEST_MAX_SATS = 1_000_000;
export const BOT_BURST_REQUEST_AMOUNT_BUCKETS = Object.freeze([
    { min: 1000, max: 9999, step: 100, weight: 15 },
    { min: 10000, max: 99999, step: 1000, weight: 65 },
    { min: 100000, max: 299999, step: 5000, weight: 15 },
    { min: 300000, max: 1_000_000, step: 10000, weight: 5 },
]);

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
    const raw = lowerText(String(value ?? ''));
    if (raw.endsWith('ms')) {
        return Number(raw.slice(0, -2));
    }
    if (raw.endsWith('s')) {
        return Number(raw.slice(0, -1)) * 1000;
    }
    return Number(raw);
}
