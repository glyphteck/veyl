import { CHAT_LIST_PAGE_SIZE, CHAT_LIST_SNAPSHOT_COALESCE_MS } from '../config.js';
import { canRenderChatPreview } from './messages.js';
import { openOwnChatEntry, ownChatEntryId, sealOwnChatEntry } from './entry.js';
import { processInbox } from './inbox.js';
import { canonicalChatVersions, isChatUnseenForUser, isCurrentUserChatEntry } from './chats.js';
import { sameBytes } from './equal.js';
import { timestampKey, timestampMs } from '../utils/time.js';
import { positiveInt } from '../utils/number.js';

function chatDocDataEqual(a, b) {
    if (a === b) {
        return true;
    }
    return !!a && !!b && timestampKey(a.ts ?? null) === timestampKey(b.ts ?? null) && sameBytes(a.body, b.body);
}

function normalizeChatPreview(msgData, message) {
    if (!message || typeof message !== 'object') {
        return null;
    }

    const normalized = {
        ...message,
        ts: msgData?.ts ?? null,
        ttl: msgData?.ttl ?? null,
    };
    return canRenderChatPreview(normalized) ? normalized : null;
}

async function readEntries(userChatPK, userPrivKey, docs, cache, options = {}) {
    return (await readEntryPage(null, userChatPK, userPrivKey, docs, cache, { ...options, checkStatus: false })).chats;
}

async function readEntryPage(cloud, userChatPK, userPrivKey, docs, cache, options = {}) {
    if (cache?.size && options?.prune !== false) {
        const keep = new Set((docs || []).map((entry) => entry.id));
        for (const id of cache.keys()) {
            if (!keep.has(id)) {
                cache.delete(id);
            }
        }
    }

    const rawChats = (await Promise.all((docs || []).map((docSnap) => readEntryResult(docSnap, userChatPK, userPrivKey, cache)))).filter(Boolean);
    const canonicalChats = canonicalChatVersions(rawChats);
    const inactiveChatIds = options?.checkStatus === false ? new Set() : await getInactiveChatIds(cloud, canonicalChats);
    const activeChats = inactiveChatIds.size ? canonicalChats.filter((chat) => !inactiveChatIds.has(chat.id)) : canonicalChats;
    return {
        chats: activeChats,
        deletedEntryIds: [
            ...canonicalChats.filter((chat) => inactiveChatIds.has(chat.id)).map((chat) => chat.entryId).filter(Boolean),
        ],
    };
}

async function deleteConfirmedUserChats(cloud, uid, entryIds) {
    if (typeof cloud?.user?.chats?.delete !== 'function' || !Array.isArray(entryIds) || !entryIds.length) {
        return;
    }
    await Promise.all(entryIds.map((entryId) => cloud.user.chats.delete(uid, entryId).catch(() => {})));
}

async function getInactiveChatIds(cloud, chats) {
    if (typeof cloud?.chat?.check !== 'function' || !Array.isArray(chats) || !chats.length) {
        return new Set();
    }

    const ids = [...new Set(chats.map((chat) => chat?.id).filter(Boolean))];
    if (!ids.length) {
        return new Set();
    }

    const status = await cloud.chat.check(ids);
    return new Set((status || []).filter((item) => item?.active === false).map((item) => item.chatId).filter(Boolean));
}

export async function filterActiveUserChats(cloud, uid, chats) {
    const canonicalChats = canonicalChatVersions(chats || []);
    const inactiveChatIds = await getInactiveChatIds(cloud, canonicalChats);
    if (!inactiveChatIds.size) {
        return canonicalChats;
    }

    await deleteConfirmedUserChats(
        cloud,
        uid,
        canonicalChats.filter((chat) => inactiveChatIds.has(chat.id)).map((chat) => chat.entryId).filter(Boolean)
    );
    return canonicalChats.filter((chat) => !inactiveChatIds.has(chat.id));
}

export async function restoreUserChats(cloud, uid, userPrivKey, chats) {
    if (typeof cloud?.user?.chats?.write !== 'function' || !uid || !userPrivKey || !Array.isArray(chats) || !chats.length) {
        return 0;
    }

    const writes = chats.filter(isCurrentUserChatEntry).map(async (chat) => {
        const entryId = ownChatEntryId(userPrivKey, chat.id);
        const tsMs = timestampMs(chat.ts, null, { positive: true }) ?? Date.now();
        await cloud.user.chats.write(uid, entryId, {
            body: await sealOwnChatEntry(userPrivKey, entryId, {
                linkId: chat.linkId,
                chatId: chat.id,
                peerChatPK: chat.peerChatPK,
                peerUid: chat.peerUid || null,
                actors: chat.actors || {},
                settings: chat.settings,
                preview: chat.preview || null,
                saved: chat.saved || null,
                readMs: timestampMs(chat.readMs, null, { positive: true }) ?? null,
            }),
            tsMs,
        });
        return true;
    });
    const results = await Promise.allSettled(writes);
    return results.filter((result) => result.status === 'fulfilled' && result.value).length;
}

export function listenToChats(cloud, uid, userChatPK, userPrivKey, onUpdate, onError, options = {}) {
    const pageSize = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_LIST_PAGE_SIZE);
    const cache = new Map();
    let run = 0;
    let snapshotVersion = 0;
    let timer = null;
    let pending = null;
    let processing = false;
    let inboxProcessing = false;
    let inboxQueued = false;
    let closed = false;
    let processedFirst = false;
    let latestChats = [];
    let latestMeta = {
        nextAfterChat: null,
        hasMore: false,
    };
    const optimisticChats = new Map();

    const mergedChats = (chats) => {
        const nextById = new Map((chats || []).filter(Boolean).map((chat) => [chat.id, chat]));
        for (const chat of chats || []) {
            const optimistic = optimisticChats.get(chat?.id);
            if (!optimistic) {
                continue;
            }
            if ((chat?.ts || 0) >= (optimistic?.ts || 0)) {
                optimisticChats.delete(chat.id);
            } else {
                nextById.set(chat.id, optimistic);
            }
        }
        for (const [id, chat] of optimisticChats.entries()) {
            if (!nextById.has(id)) {
                nextById.set(id, chat);
            }
        }
        return canonicalChatVersions([...nextById.values()]);
    };

    const publishPingChat = (chat) => {
        if (closed || !chat?.id) {
            return;
        }
        const existing = optimisticChats.get(chat.id) || latestChats.find((current) => current?.id === chat.id);
        if (existing && (existing?.ts || 0) > (chat?.ts || 0)) {
            return;
        }
        optimisticChats.set(chat.id, chat);
        latestChats = mergedChats(latestChats);
        onUpdate(latestChats, latestChats.map((item) => item.peerChatPK).filter(Boolean), {
            nextAfterChat: latestMeta.nextAfterChat,
            hasMore: latestMeta.hasMore,
        });
    };

    const processPending = () => {
        timer = null;
        if (closed || processing || !pending) {
            return;
        }

        const current = pending;
        pending = null;
        processing = true;
        const runId = ++run;
        void Promise.resolve(current)
            .then(async (snapshot) => ({
                snapshot,
                page: await readEntryPage(cloud, userChatPK, userPrivKey, snapshot.docs, cache),
            }))
            .then(({ snapshot, page }) => {
                if (!closed && runId === run) {
                    processedFirst = true;
                    const chats = page.chats;
                    latestChats = mergedChats(chats);
                    latestMeta = {
                        nextAfterChat: snapshot.nextAfterChat,
                        hasMore: snapshot.hasMore,
                    };
                    onUpdate(latestChats, latestChats.map((chat) => chat.peerChatPK).filter(Boolean), {
                        nextAfterChat: snapshot.nextAfterChat,
                        hasMore: snapshot.hasMore,
                    });
                    void deleteConfirmedUserChats(cloud, uid, page.deletedEntryIds);
                }
            })
            .catch((error) => {
                if (!closed && runId === run) {
                    onError?.(error);
                }
            })
            .finally(() => {
                processing = false;
                if (pending && !closed) {
                    timer = setTimeout(processPending, CHAT_LIST_SNAPSHOT_COALESCE_MS);
                }
            });
    };

    const processQueuedInbox = () => {
        if (closed || inboxProcessing || !inboxQueued) {
            return;
        }
        inboxQueued = false;
        inboxProcessing = true;
        void processInbox(cloud, uid, userChatPK, userPrivKey, {
            currentChats: latestChats,
            onPingChat: publishPingChat,
            onPingError: (error) => {
                console.warn('Inbox ping process failed', error);
            },
        })
            .catch((error) => {
                if (!closed) {
                    console.warn('Inbox process failed', error);
                }
            })
            .finally(() => {
                inboxProcessing = false;
                if (inboxQueued && !closed) {
                    setTimeout(processQueuedInbox, 0);
                }
            });
    };

    const queueInboxProcess = () => {
        if (closed) {
            return;
        }
        inboxQueued = true;
        if (!inboxProcessing) {
            setTimeout(processQueuedInbox, 0);
        }
    };

    const schedule = (delayMs) => {
        if (timer || processing || closed) {
            return;
        }
        timer = setTimeout(processPending, delayMs);
    };

    const unsub = cloud.user.chats.watch(
        uid,
        (entries, meta = {}) => {
            pending = {
                version: ++snapshotVersion,
                docs: entries,
                nextAfterChat: meta.nextAfterChat ?? null,
                hasMore: !!meta.hasMore,
            };
            schedule(processedFirst ? CHAT_LIST_SNAPSHOT_COALESCE_MS : 0);
        },
        onError,
        { limitCount: pageSize }
    );
    const inboxUnsub = cloud.inbox.watch(
        uid,
        (items, info = {}) => {
            if (info.pending || !items.length) {
                return;
            }
            queueInboxProcess();
        },
        onError
    );
    return () => {
        closed = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        pending = null;
        inboxQueued = false;
        unsub?.();
        inboxUnsub?.();
    };
}

export async function loadMoreChats(cloud, uid, userChatPK, userPrivKey, afterChat, pageSize) {
    if (!cloud || !uid || !userChatPK || !userPrivKey || !afterChat) {
        return {
            chats: [],
            peers: [],
            nextAfterChat: null,
            hasMore: false,
        };
    }

    const count = positiveInt(pageSize, CHAT_LIST_PAGE_SIZE);
    const page = await cloud.user.chats.list(uid, { count, afterChat });
    const entryPage = await readEntryPage(cloud, userChatPK, userPrivKey, page.records, new Map(), { prune: false });
    void deleteConfirmedUserChats(cloud, uid, entryPage.deletedEntryIds);
    const nextAfterChat = page.nextAfterChat ?? null;
    return {
        chats: entryPage.chats,
        peers: entryPage.chats.map((chat) => chat.peerChatPK).filter(Boolean),
        nextAfterChat,
        hasMore: !!page.hasMore && !!nextAfterChat,
    };
}

export async function loadAllChats(cloud, uid, userChatPK, userPrivKey, pageSize = CHAT_LIST_PAGE_SIZE) {
    if (!cloud || !uid || !userChatPK || !userPrivKey) {
        return [];
    }

    const count = positiveInt(pageSize, CHAT_LIST_PAGE_SIZE);
    const cache = new Map();
    const chats = [];
    let afterChat = null;
    let hasMore = true;

    while (hasMore) {
        const page = await cloud.user.chats.list(uid, { count, afterChat });
        const records = Array.isArray(page?.records) ? page.records : [];
        if (!records.length) {
            break;
        }
        const pageChats = await readEntries(userChatPK, userPrivKey, records, cache, { prune: false });
        chats.push(...pageChats);
        afterChat = page?.nextAfterChat ?? null;
        hasMore = !!page?.hasMore && !!afterChat;
    }

    return canonicalChatVersions(chats);
}

export async function getChat(cloud, uid, chatId, userChatPK, userPrivKey) {
    if (!cloud || !uid || !chatId || !userChatPK || !userPrivKey) {
        return null;
    }
    const entryId = ownChatEntryId(userPrivKey, chatId);
    const entry = await cloud.user.chats.read(uid, entryId).catch(() => null);
    if (!entry) {
        return null;
    }
    const chat = await chatFromEntry(entry, userChatPK, userPrivKey, new Map());
    if (chat?.id !== chatId) {
        return null;
    }
    const inactiveChatIds = await getInactiveChatIds(cloud, [chat]);
    if (inactiveChatIds.has(chatId)) {
        await deleteConfirmedUserChats(cloud, uid, [entry.id]);
        return null;
    }
    return chat;
}

async function decryptChatEntry(entryRecord, userChatPK, userPrivKey) {
    const data = entryRecord;
    const entry = await openOwnChatEntry(userPrivKey, entryRecord.id, data?.body);
    const preview = normalizeChatPreview({ ts: data?.ts ?? null, ttl: entry?.preview?.ttl ?? null }, entry?.preview);
    const visiblePreview = preview && canRenderChatPreview(preview) ? preview : null;
    const ts = timestampMs(data?.ts, null) ?? 0;
    const readMs = timestampMs(entry.readMs, null);
    if (!ts) {
        return null;
    }
    return {
        id: entry.chatId,
        linkId: entry.linkId,
        entryId: entryRecord.id,
        peerChatPK: entry.peerChatPK,
        peerUid: entry.peerUid || null,
        actors: entry.actors || {},
        settings: entry.settings,
        saved: entry.saved || null,
        readMs,
        preview: visiblePreview,
        ts,
        unseen: visiblePreview ? isChatUnseenForUser({ preview: visiblePreview, readMs }, userChatPK) : false,
    };
}

async function chatFromEntry(entryRecord, userChatPK, userPrivKey, cache) {
    const data = entryRecord;
    const cached = cache?.get?.(entryRecord.id);
    if (cached && chatDocDataEqual(cached.data, data)) {
        return cached.chat;
    }

    const chat = await decryptChatEntry(entryRecord, userChatPK, userPrivKey);
    if (!isCurrentUserChatEntry(chat)) {
        throw new Error('invalid chat entry');
    }
    cache?.set?.(entryRecord.id, { data, chat });
    return chat;
}

async function readEntryResult(entryRecord, userChatPK, userPrivKey, cache) {
    try {
        return await chatFromEntry(entryRecord, userChatPK, userPrivKey, cache);
    } catch {
        cache?.delete?.(entryRecord?.id);
        return null;
    }
}
