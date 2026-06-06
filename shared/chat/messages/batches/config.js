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
    CHAT_WARM_BATCH_SIZE,
    CHAT_WARM_DELAY_MS,
} from '../../../config.js';
import { nonNegativeNumber, positiveNumber } from '../../../utils/number.js';

export const MESSAGE_VIEW_CACHE_SIZE = CHAT_MESSAGE_VIEW_CACHE_SIZE;
export const VISITED_CHAT_PREFETCH_OLDER_BATCHES = CHAT_VISITED_PREFETCH_OLDER_BATCHES;

export const DEFAULT_MEDIA_WARMING = Object.freeze({
    enabled: false,
    chatCount: CHAT_TOP_WARM_COUNT,
    messagesPerChat: CHAT_MEDIA_WARM_MESSAGES_PER_CHAT,
    startDelayMs: CHAT_MEDIA_WARM_START_DELAY_MS,
    stepDelayMs: CHAT_MEDIA_WARM_STEP_DELAY_MS,
    types: CHAT_MEDIA_WARM_TYPES,
    maxBytes: CHAT_MEDIA_WARM_MAX_BYTES,
});

export const DEFAULT_CHAT_WARMING = Object.freeze({
    enabled: false,
    eagerCount: CHAT_EAGER_WARM_COUNT,
    count: CHAT_TOP_WARM_COUNT,
    delayMs: CHAT_WARM_DELAY_MS,
    pageSize: CHAT_WARM_BATCH_SIZE,
    media: DEFAULT_MEDIA_WARMING,
});

// Top chats are the first recent, non-deleting chats in provider order. Provider chats are sorted by chat.ts.
export const IOS_CHAT_WARMING = Object.freeze({
    enabled: true,
    eagerCount: CHAT_EAGER_WARM_COUNT,
    count: CHAT_TOP_WARM_COUNT,
    delayMs: CHAT_WARM_DELAY_MS,
    pageSize: CHAT_WARM_BATCH_SIZE,
    media: Object.freeze({
        enabled: false,
    }),
});

export const WEB_CHAT_WARMING = IOS_CHAT_WARMING;

function cleanMediaTypes(types) {
    return Array.isArray(types) && types.length ? types.map((type) => String(type || '').trim()).filter(Boolean) : DEFAULT_MEDIA_WARMING.types;
}

export function normalizeMediaWarming(media, chatCount) {
    if (!media) {
        return DEFAULT_MEDIA_WARMING;
    }
    const types = cleanMediaTypes(media.types);
    return {
        ...DEFAULT_MEDIA_WARMING,
        ...media,
        enabled: media.enabled !== false,
        chatCount: nonNegativeNumber(media.chatCount, chatCount),
        messagesPerChat: positiveNumber(media.messagesPerChat, DEFAULT_MEDIA_WARMING.messagesPerChat),
        startDelayMs: nonNegativeNumber(media.startDelayMs, DEFAULT_MEDIA_WARMING.startDelayMs),
        stepDelayMs: nonNegativeNumber(media.stepDelayMs, DEFAULT_MEDIA_WARMING.stepDelayMs),
        types,
    };
}

export function normalizeChatWarming(warming) {
    if (!warming) {
        return DEFAULT_CHAT_WARMING;
    }

    const config = {
        ...DEFAULT_CHAT_WARMING,
        ...warming,
        enabled: warming.enabled !== false,
    };
    const warmCount = nonNegativeNumber(warming.count, DEFAULT_CHAT_WARMING.count);
    const eagerCount = Math.min(nonNegativeNumber(warming.eagerCount, DEFAULT_CHAT_WARMING.eagerCount), warmCount);
    return {
        ...config,
        count: warmCount,
        eagerCount,
        delayMs: nonNegativeNumber(warming.delayMs, DEFAULT_CHAT_WARMING.delayMs),
        pageSize: positiveNumber(warming.pageSize, DEFAULT_CHAT_WARMING.pageSize),
        media: normalizeMediaWarming(config.media, warmCount),
    };
}
