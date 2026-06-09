import {
    BOT_TRAFFIC_DEFAULT_COUNT,
    BOT_TRAFFIC_DEFAULT_DELAY_MS,
    BOT_TRAFFIC_MAX_COUNT,
    BOT_TRAFFIC_MIN_DELAY_MS,
} from '../../config.js';
import { lowerText } from '../../utils/text.js';

export const BOT_TRAFFIC_GROUP = 'traffic';

export function botTrafficGroups({ traffic = false } = {}) {
    return {
        [BOT_TRAFFIC_GROUP]: traffic === true,
    };
}

export function hasBotTrafficGroup(value) {
    return value?.groups?.[BOT_TRAFFIC_GROUP] === true;
}

export function cleanTrafficCount(value, name = 'traffic count') {
    const count = Number(value ?? BOT_TRAFFIC_DEFAULT_COUNT);
    if (!Number.isInteger(count) || count <= 0 || count > BOT_TRAFFIC_MAX_COUNT) {
        throw new Error(`${name} must be an integer from 1 to ${BOT_TRAFFIC_MAX_COUNT}`);
    }
    return count;
}

export function cleanTrafficDelayMs(value, { name = 'traffic delay', text = false } = {}) {
    const raw = value ?? BOT_TRAFFIC_DEFAULT_DELAY_MS;
    const delayMs = text ? parseDelayText(raw) : Number(raw);
    if (!Number.isFinite(delayMs) || delayMs < BOT_TRAFFIC_MIN_DELAY_MS) {
        throw new Error(`${name} must be at least ${BOT_TRAFFIC_MIN_DELAY_MS}ms`);
    }
    return Math.round(delayMs);
}

function parseDelayText(value) {
    const raw = lowerText(String(value ?? ''));
    if (raw.endsWith('min')) {
        return Number(raw.slice(0, -3)) * 60 * 1000;
    }
    if (raw.endsWith('ms')) {
        return Number(raw.slice(0, -2));
    }
    if (raw.endsWith('m')) {
        return Number(raw.slice(0, -1)) * 60 * 1000;
    }
    if (raw.endsWith('s')) {
        return Number(raw.slice(0, -1)) * 1000;
    }
    return Number(raw);
}
