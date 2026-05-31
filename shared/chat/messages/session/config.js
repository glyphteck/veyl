'use client';

import {
    CHAT_EAGER_WARM_COUNT,
    CHAT_MEDIA_WARM_MAX_BYTES,
    CHAT_MEDIA_WARM_MESSAGES_PER_CHAT,
    CHAT_MEDIA_WARM_START_DELAY_MS,
    CHAT_MEDIA_WARM_STEP_DELAY_MS,
    CHAT_MEDIA_WARM_TYPES,
    CHAT_MESSAGE_VIEW_CACHE_SIZE,
    CHAT_TOP_WARM_COUNT,
    CHAT_VISITED_PREFETCH_OLDER_BATCHES,
    CHAT_WARM_BATCH_SIZE as CONFIG_CHAT_WARM_BATCH_SIZE,
    CHAT_WARM_DELAY_MS as CONFIG_CHAT_WARM_DELAY_MS,
} from '../../../config.js';
import { nonNegativeNumber, positiveNumber } from '../../../utils/number.js';

export const TOP_CHAT_WARM_COUNT = CHAT_TOP_WARM_COUNT;
export const EAGER_CHAT_WARM_COUNT = CHAT_EAGER_WARM_COUNT;
export const CHAT_WARM_COUNT = TOP_CHAT_WARM_COUNT;
export const CHAT_WARM_DELAY_MS = CONFIG_CHAT_WARM_DELAY_MS;
export const CHAT_WARM_BATCH_SIZE = CONFIG_CHAT_WARM_BATCH_SIZE;
export const MESSAGE_VIEW_CACHE_SIZE = CHAT_MESSAGE_VIEW_CACHE_SIZE;
export const VISITED_CHAT_PREFETCH_OLDER_BATCHES = CHAT_VISITED_PREFETCH_OLDER_BATCHES;

export const MEDIA_WARM_CHAT_COUNT = TOP_CHAT_WARM_COUNT;
export const MEDIA_WARM_MESSAGES_PER_CHAT = CHAT_MEDIA_WARM_MESSAGES_PER_CHAT;
export const MEDIA_WARM_START_DELAY_MS = CHAT_MEDIA_WARM_START_DELAY_MS;
export const MEDIA_WARM_STEP_DELAY_MS = CHAT_MEDIA_WARM_STEP_DELAY_MS;
export const MEDIA_WARM_TYPES = CHAT_MEDIA_WARM_TYPES;
export const MEDIA_WARM_MAX_BYTES = CHAT_MEDIA_WARM_MAX_BYTES;

export const DEFAULT_MEDIA_WARMING = Object.freeze({
    enabled: false,
    chatCount: MEDIA_WARM_CHAT_COUNT,
    messagesPerChat: MEDIA_WARM_MESSAGES_PER_CHAT,
    startDelayMs: MEDIA_WARM_START_DELAY_MS,
    stepDelayMs: MEDIA_WARM_STEP_DELAY_MS,
    types: MEDIA_WARM_TYPES,
    maxBytes: MEDIA_WARM_MAX_BYTES,
});

export const DEFAULT_CHAT_WARMING = Object.freeze({
    enabled: false,
    eagerCount: EAGER_CHAT_WARM_COUNT,
    count: CHAT_WARM_COUNT,
    delayMs: CHAT_WARM_DELAY_MS,
    pageSize: CHAT_WARM_BATCH_SIZE,
    media: DEFAULT_MEDIA_WARMING,
});

// Top chats are the first recent, non-deleting rows in provider order. Provider rows are sorted by chat.ts.
export const IOS_CHAT_WARMING = Object.freeze({
    enabled: true,
    eagerCount: EAGER_CHAT_WARM_COUNT,
    count: CHAT_WARM_COUNT,
    delayMs: CHAT_WARM_DELAY_MS,
    pageSize: CHAT_WARM_BATCH_SIZE,
    media: Object.freeze({
        enabled: false,
    }),
});

export const WEB_CHAT_WARMING = Object.freeze({
    ...IOS_CHAT_WARMING,
    media: Object.freeze({
        enabled: false,
    }),
});

function firstDefined(...values) {
    return values.find((value) => value !== undefined);
}

function cleanMediaTypes(types) {
    return Array.isArray(types) && types.length ? types.map((type) => String(type || '').trim()).filter(Boolean) : DEFAULT_MEDIA_WARMING.types;
}

export function normalizeMediaWarming(media, chatCount) {
    if (!media) {
        return DEFAULT_MEDIA_WARMING;
    }
    if (media === true) {
        return { ...DEFAULT_MEDIA_WARMING, enabled: true, chatCount };
    }
    const types = cleanMediaTypes(media.types);
    return {
        ...DEFAULT_MEDIA_WARMING,
        ...media,
        enabled: media.enabled !== false,
        chatCount: nonNegativeNumber(firstDefined(media.chatCount, media.topChatCount), chatCount),
        messagesPerChat: positiveNumber(firstDefined(media.messagesPerChat, media.batchMessages, media.messagesPerBatch), DEFAULT_MEDIA_WARMING.messagesPerChat),
        startDelayMs: nonNegativeNumber(media.startDelayMs, DEFAULT_MEDIA_WARMING.startDelayMs),
        stepDelayMs: nonNegativeNumber(media.stepDelayMs, DEFAULT_MEDIA_WARMING.stepDelayMs),
        types,
    };
}

export function normalizeChatWarming(warming) {
    if (!warming) {
        return DEFAULT_CHAT_WARMING;
    }

    const raw = warming === true ? { enabled: true } : warming;
    const config =
        warming === true
            ? { ...DEFAULT_CHAT_WARMING, enabled: true }
            : {
                  ...DEFAULT_CHAT_WARMING,
                  ...warming,
                  enabled: warming.enabled !== false,
              };
    const warmCount = nonNegativeNumber(firstDefined(raw.count, raw.preSubscribeCount, raw.topChatCount, config.count), DEFAULT_CHAT_WARMING.count);
    const eagerCount = Math.min(nonNegativeNumber(firstDefined(raw.eagerCount, raw.eagerPreSubscribeCount, config.eagerCount), DEFAULT_CHAT_WARMING.eagerCount), warmCount);
    return {
        ...config,
        count: warmCount,
        eagerCount,
        delayMs: nonNegativeNumber(firstDefined(raw.delayMs, raw.staggerDelayMs, config.delayMs), DEFAULT_CHAT_WARMING.delayMs),
        pageSize: positiveNumber(firstDefined(raw.pageSize, raw.batchSize, config.pageSize), DEFAULT_CHAT_WARMING.pageSize),
        media: normalizeMediaWarming(config.media, warmCount),
    };
}
