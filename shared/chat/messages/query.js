import { hasMsgData, openMsg } from '../../crypto/chat.js';
import {
    CHAT_MESSAGE_BATCH_SIZE,
    CHAT_MESSAGE_QUERY_MAX_DOCS,
} from '../../config.js';
import { messageKeys } from '../messagekeys.js';
import { canShowMsg, canStoreMsg, collapseSystemMessages, getDisplayMessages, isExpiredMsg } from '../messages.js';
import { getCachedPair } from '../pairs.js';
import { sameBytes, sameHead } from '../equal.js';
import { positiveInt } from '../../utils/number.js';
import { cleanText } from '../../utils/text.js';
import { timestampKey, timestampMs } from '../../utils/time.js';

export const MSG_BATCH_SIZE = CHAT_MESSAGE_BATCH_SIZE;
export const MSG_QUERY_MAX_DOCS = CHAT_MESSAGE_QUERY_MAX_DOCS;

function messageDataExpired(msgData, now = Date.now()) {
    return isExpiredMsg({ ttl: msgData?.ttl ?? null }, now);
}

function partitionExpiredMessageRecords(records, expiredKeys, cache, now = Date.now()) {
    const activeRecords = [];
    const expiredRecords = [];

    for (const record of records || []) {
        const msgData = record;
        if (!messageDataExpired(msgData, now)) {
            activeRecords.push(record);
            continue;
        }

        addMessageRecordKeys(expiredKeys, record);
        cache?.delete?.(record.id);
    }

    return { activeRecords, expiredRecords };
}

function addMessageRecordKeys(keys, record) {
    if (!keys || !record) {
        return;
    }
    if (record.id) {
        keys.add(record.id);
    }
    const cid = record?.head?.cid;
    const key = cleanText(cid);
    if (key) {
        keys.add(key);
    }
}

function normalizeDecryptedMsg(msgData, message) {
    if (!message || typeof message !== 'object') {
        return null;
    }

    const normalized = {
        ...message,
        ts: msgData?.ts ?? null,
        ttl: msgData?.ttl ?? null,
    };
    return canStoreMsg(normalized) ? normalized : null;
}

function messageRecordDataEqual(a, b) {
    if (a === b) {
        return true;
    }
    return !!a && !!b && sameHead(a?.head, b?.head) && sameBytes(a?.body, b?.body) && timestampKey(a?.ttl ?? null) === timestampKey(b?.ttl ?? null) && timestampKey(a?.ts ?? null) === timestampKey(b?.ts ?? null);
}

function messageRecordsEqual(prev, records) {
    if (!Array.isArray(prev) || !Array.isArray(records) || prev.length !== records.length) {
        return false;
    }
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const cached = prev[index];
        if (cached?.id !== record.id || !messageRecordDataEqual(cached.data, record)) {
            return false;
        }
    }
    return true;
}

function cachedMessageBody(cacheEntry, msgData, docId) {
    const head = msgData?.head;
    if (!cacheEntry || !head || cacheEntry.cid !== head.cid || !sameBytes(cacheEntry.body, msgData?.body)) {
        return null;
    }

    const tsKey = timestampKey(msgData?.ts ?? null);
    const ttlKey = timestampKey(msgData?.ttl ?? null);
    if (cacheEntry.tsKey === tsKey && cacheEntry.ttlKey === ttlKey) {
        return cacheEntry.message;
    }

    cacheEntry.tsKey = tsKey;
    cacheEntry.ttlKey = ttlKey;
    cacheEntry.message = {
        ...cacheEntry.message,
        id: docId,
        ts: msgData?.ts ?? null,
        ttl: msgData?.ttl ?? null,
    };
    return cacheEntry.message;
}

function cacheMessageBody(cache, docId, msgData, message) {
    if (!cache || !docId || !message) {
        return;
    }

    const next = { ...message, id: docId };
    cache.set(docId, {
        cid: msgData?.head?.cid,
        body: msgData?.body,
        tsKey: timestampKey(msgData?.ts ?? null),
        ttlKey: timestampKey(msgData?.ttl ?? null),
        message: next,
    });
    return next;
}

async function decryptRecord(record, userChatPK, userPrivKey, peerChatPK, cache, options = {}) {
    const msgData = record;
    if (messageDataExpired(msgData)) {
        cache?.delete?.(record.id);
        return null;
    }

    const cached = cachedMessageBody(cache?.get?.(record.id), msgData, record.id);
    if (cached) {
        return cached;
    }

    const dec = await decryptMsg(msgData, userChatPK, userPrivKey, peerChatPK, options);
    if (!dec) {
        cache?.delete?.(record.id);
        return null;
    }

    return cacheMessageBody(cache, record.id, msgData, dec) ?? { ...dec, id: record.id };
}

function pruneMessageCache(cache, records) {
    if (!cache?.size) {
        return;
    }
    const keep = new Set((records || []).map((record) => record.id).filter(Boolean));
    for (const id of cache.keys()) {
        if (!keep.has(id)) {
            cache.delete(id);
        }
    }
}

async function decryptRecordEntries(records, userChatPK, userPrivKey, peerChatPK, cache, options = {}) {
    const entries = await Promise.all(
        records.map(async (record) => {
            const message = await decryptRecord(record, userChatPK, userPrivKey, peerChatPK, cache, options);
            return message ? { record, message } : null;
        })
    );
    return entries.filter(Boolean);
}

function messageQueryLimit(pageSize) {
    return positiveInt(pageSize, MSG_BATCH_SIZE);
}

function messageQueryMax(pageSize) {
    return Math.max(messageQueryLimit(pageSize), MSG_QUERY_MAX_DOCS);
}

function nextMessageQueryLimit(current, max) {
    return Math.min(max, Math.max(current + 1, current * 2));
}

function readableEntryIndexes(entries, chatPK, peerChatPK) {
    const source = entries || [];
    const entryIndexByKey = new Map();
    for (let index = 0; index < source.length; index += 1) {
        for (const key of messageKeys(source[index]?.message)) {
            if (!entryIndexByKey.has(key)) {
                entryIndexByKey.set(key, index);
            }
        }
    }

    const messages = source.map((entry) => entry?.message).filter(Boolean);
    const visibleMessages = collapseSystemMessages(getDisplayMessages(messages, chatPK, peerChatPK)).filter(canShowMsg);
    const seen = new Set();
    const indexes = [];
    for (const message of visibleMessages) {
        for (const key of messageKeys(message)) {
            const index = entryIndexByKey.get(key);
            if (index == null || seen.has(index)) {
                continue;
            }
            seen.add(index);
            indexes.push(index);
            break;
        }
    }
    return indexes;
}

function readableEntryWindow(entries, pageSize, chatPK, peerChatPK) {
    const source = entries || [];
    const limitCount = positiveInt(pageSize, MSG_BATCH_SIZE);
    const indexes = readableEntryIndexes(source, chatPK, peerChatPK);

    if (indexes.length < limitCount) {
        return { count: indexes.length, entries: source };
    }

    const start = indexes[indexes.length - limitCount] ?? 0;
    return { count: indexes.length, entries: source.slice(start) };
}

function recordIndexById(records, id) {
    if (!id) {
        return -1;
    }
    return (records || []).findIndex((record) => record.id === id);
}

function olderThanMarker(record) {
    if (!record) {
        return null;
    }
    return {
        id: record.id,
        ts: record.ts ?? null,
    };
}

export async function decryptMsg(msgData, userChatPK, userPrivKey, peerChatPK, options = {}) {
    if (!hasMsgData(msgData) || !userChatPK || !userPrivKey || !peerChatPK) {
        return null;
    }
    if (messageDataExpired(msgData)) {
        return null;
    }

    try {
        const pair = await getCachedPair(userChatPK, userPrivKey, peerChatPK, { chatId: options?.chatId });
        const message = await openMsg(pair, msgData, { actors: options?.actors });
        return normalizeDecryptedMsg(msgData, message);
    } catch {
        return null;
    }
}

export function listenToLatestMsgs(cloud, chatId, userChatPK, userPrivKey, peerChatPK, pageSize, onUpdate, onError, options = {}) {
    const queryLimit = messageQueryLimit(pageSize);
    const maxQueryLimit = messageQueryMax(pageSize);
    const decryptedCache = new Map();
    let lastVisibleRecords = null;
    let lastExpiredKeys = '';
    let lastDeletedKeys = '';
    let unsub = null;
    let closed = false;
    let run = 0;

    function listen(limitCount) {
        unsub = cloud.chat.messages.watch(
            chatId,
            { count: limitCount },
            async (records, info = {}) => {
                if (closed) {
                    return;
                }

                if (info.fromCache) {
                    onUpdate({
                        messages: [],
                        olderThan: null,
                        carry: null,
                        hasOlder: false,
                        hasMore: false,
                        exists: true,
                        fromCache: true,
                    });
                    return;
                }

                const runId = ++run;
                const now = Date.now();
                const changes = info.changes || [];
                const expiredKeys = new Set();
                const removedRecords = [];
                for (const change of changes) {
                    if (change.type === 'removed' && messageDataExpired(change.record, now)) {
                        addMessageRecordKeys(expiredKeys, change.record);
                    } else if (change.type === 'removed' && !change.record?.pending) {
                        removedRecords.push(change.record);
                    }
                }
                const { activeRecords } = partitionExpiredMessageRecords(records, expiredKeys, decryptedCache, now);
                const active = activeRecords;
                const allEntries = await decryptRecordEntries(active, userChatPK, userPrivKey, peerChatPK, decryptedCache, { actors: options?.actors, chatId });
                if (runId !== run) {
                    return;
                }
                let readableWindow = readableEntryWindow(allEntries, pageSize, userChatPK, peerChatPK);
                if (readableWindow.count < queryLimit && records.length >= limitCount && limitCount < maxQueryLimit) {
                    const nextLimit = nextMessageQueryLimit(limitCount, maxQueryLimit);
                    unsub?.();
                    if (!closed) {
                        listen(nextLimit);
                    }
                    return;
                }

                const entries = readableWindow.entries;
                const visibleRecords = entries.map((entry) => entry.record);
                const visibleStart = recordIndexById(active, visibleRecords[0]?.id);
                const carry = visibleStart > 0 ? olderThanMarker(active[visibleStart - 1]) : null;
                const queryFilled = records.length >= limitCount;
                const queryStartMs = timestampMs(active[0]?.ts, null);
                const deletedKeys = new Set();
                for (const record of removedRecords) {
                    const removedMs = timestampMs(record?.ts, null);
                    if (!queryFilled || queryStartMs == null || removedMs == null || removedMs >= queryStartMs) {
                        addMessageRecordKeys(deletedKeys, record);
                    }
                }
                const expiredKeysKey = [...expiredKeys].sort().join('|');
                const deletedKeysKey = [...deletedKeys].sort().join('|');
                if (messageRecordsEqual(lastVisibleRecords, visibleRecords) && expiredKeysKey === lastExpiredKeys && deletedKeysKey === lastDeletedKeys) {
                    return;
                }
                pruneMessageCache(decryptedCache, visibleRecords);
                const messages = entries.map((entry) => entry.message);
                const olderThan = olderThanMarker(visibleRecords[0] ?? active[0] ?? records[0] ?? null);
                lastVisibleRecords = visibleRecords.map((record) => ({ id: record.id, data: record }));
                lastExpiredKeys = expiredKeysKey;
                lastDeletedKeys = deletedKeysKey;
                onUpdate({
                    messages,
                    olderThan,
                    carry,
                    hasOlder: visibleStart > 0 || queryFilled,
                    hasMore: visibleStart > 1 || queryFilled,
                    exists: true,
                    fromCache: !!info.fromCache,
                    expiredKeys: [...expiredKeys],
                    deletedKeys: [...deletedKeys],
                });
            },
            onError
        );
    }

    listen(queryLimit);
    return () => {
        closed = true;
        unsub?.();
    };
}

export async function loadOlderMsgs(cloud, chatId, userChatPK, userPrivKey, peerChatPK, olderThan, pageSize, options = {}) {
    if (!olderThan) {
        return {
            messages: [],
            nextOlderThan: null,
            hasMore: false,
        };
    }

    try {
        const queryLimit = messageQueryLimit(pageSize);
        const maxQueryLimit = messageQueryMax(pageSize);
        const firstPage = await cloud.chat.messages.list(chatId, { olderThan, count: queryLimit });
        let rawRecords = firstPage.records || [];
        let filledQuery = !!firstPage.hasMore;
        const expiredKeys = new Set();
        let partitionedRecords = partitionExpiredMessageRecords(rawRecords, expiredKeys);
        let olderRecords = partitionedRecords.activeRecords;
        let allEntries = await decryptRecordEntries(olderRecords, userChatPK, userPrivKey, peerChatPK, undefined, { actors: options?.actors, chatId });
        let readableWindow = readableEntryWindow(allEntries, pageSize, userChatPK, peerChatPK);
        while (readableWindow.count < queryLimit && rawRecords.length < maxQueryLimit && filledQuery && rawRecords[0]) {
            const nextLimit = Math.min(queryLimit, maxQueryLimit - rawRecords.length);
            const nextPage = await cloud.chat.messages.list(chatId, {
                olderThan: olderThanMarker(rawRecords[0]),
                count: nextLimit,
            });
            const nextRecords = nextPage.records || [];
            if (!nextRecords.length) {
                filledQuery = false;
                break;
            }
            rawRecords = [...nextRecords, ...rawRecords];
            filledQuery = !!nextPage.hasMore;
            partitionedRecords = partitionExpiredMessageRecords(rawRecords, expiredKeys);
            olderRecords = partitionedRecords.activeRecords;
            allEntries = await decryptRecordEntries(olderRecords, userChatPK, userPrivKey, peerChatPK, undefined, { actors: options?.actors, chatId });
            readableWindow = readableEntryWindow(allEntries, pageSize, userChatPK, peerChatPK);
        }

        const entries = readableWindow.entries;
        const visibleRecords = entries.map((entry) => entry.record);
        const visibleStart = recordIndexById(olderRecords, visibleRecords[0]?.id);
        const messages = entries.map((entry) => entry.message);
        const nextOlderThan = olderThanMarker(visibleRecords[0] ?? olderRecords[0] ?? rawRecords[0] ?? null);

        return {
            messages,
            nextOlderThan,
            hasMore: visibleStart > 0 || filledQuery,
        };
    } catch {
        return {
            messages: [],
            nextOlderThan: null,
            hasMore: false,
        };
    }
}
