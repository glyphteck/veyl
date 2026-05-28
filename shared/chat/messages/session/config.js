'use client';

export const TOP_CHAT_WARM_COUNT = 2;
export const EAGER_CHAT_WARM_COUNT = 1;
export const CHAT_WARM_COUNT = TOP_CHAT_WARM_COUNT;
export const CHAT_WARM_DELAY_MS = 900;
export const CHAT_WARM_BATCH_SIZE = 25;
export const MESSAGE_VIEW_CACHE_SIZE = 30;
export const VISITED_CHAT_PREFETCH_OLDER_BATCHES = 1;

export const MEDIA_WARM_CHAT_COUNT = TOP_CHAT_WARM_COUNT;
export const MEDIA_WARM_MESSAGES_PER_CHAT = 20;
export const MEDIA_WARM_START_DELAY_MS = 600;
export const MEDIA_WARM_STEP_DELAY_MS = 120;
export const MEDIA_WARM_TYPES = Object.freeze(['img', 'mp4']);
export const MEDIA_WARM_MAX_BYTES = 0;

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

export function count(value, fallback) {
    const next = Number(value);
    return Number.isFinite(next) && next >= 0 ? next : fallback;
}

export function positive(value, fallback) {
    const next = Number(value);
    return Number.isFinite(next) && next > 0 ? next : fallback;
}

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
        chatCount: count(firstDefined(media.chatCount, media.topChatCount), chatCount),
        messagesPerChat: positive(firstDefined(media.messagesPerChat, media.batchMessages, media.messagesPerBatch), DEFAULT_MEDIA_WARMING.messagesPerChat),
        startDelayMs: count(media.startDelayMs, DEFAULT_MEDIA_WARMING.startDelayMs),
        stepDelayMs: count(media.stepDelayMs, DEFAULT_MEDIA_WARMING.stepDelayMs),
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
    const warmCount = count(firstDefined(raw.count, raw.preSubscribeCount, raw.topChatCount, config.count), DEFAULT_CHAT_WARMING.count);
    const eagerCount = Math.min(count(firstDefined(raw.eagerCount, raw.eagerPreSubscribeCount, config.eagerCount), DEFAULT_CHAT_WARMING.eagerCount), warmCount);
    return {
        ...config,
        count: warmCount,
        eagerCount,
        delayMs: count(firstDefined(raw.delayMs, raw.staggerDelayMs, config.delayMs), DEFAULT_CHAT_WARMING.delayMs),
        pageSize: positive(firstDefined(raw.pageSize, raw.batchSize, config.pageSize), DEFAULT_CHAT_WARMING.pageSize),
        media: normalizeMediaWarming(config.media, warmCount),
    };
}
