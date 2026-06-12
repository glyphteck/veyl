import { canRenderChatPreview, isReadReceiptMsg, withChatPreviewOpened } from './messages.js';
import { makeOwnChatEntry, openOwnChatEntry, ownChatEntryId, sealOwnChatEntry } from './entry.js';
import { openPing } from './ping.js';
import { decryptMsg } from './messages/query.js';
import { isChatUnseenForUser } from './chats.js';
import { timestampMs } from '../utils/time.js';
import { cleanText } from '../utils/text.js';

const CHAT_PING_KIND_READ = 'read';

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

async function readExistingEntry(cloud, uid, userPrivKey, entryId) {
    const entry = await cloud.user.chats.read(uid, entryId).catch(() => null);
    if (!entry) {
        return null;
    }
    return openOwnChatEntry(userPrivKey, entryId, entry.body).catch(() => null);
}

function pingTsMs(ping, preview, fallbackMs) {
    const ms = timestampMs(ping?.payload?.ts, null) ?? timestampMs(preview?.ts, null) ?? fallbackMs;
    return Number.isFinite(ms) ? ms : Date.now();
}

function pingSortMs(pingDoc, ping) {
    const payloadMs = Number(ping?.payload?.ts);
    if (Number.isFinite(payloadMs)) {
        return payloadMs;
    }
    return timestampMs(pingDoc?.ts, 0) ?? 0;
}

function pingKind(ping) {
    return cleanText(ping?.payload?.kind);
}

function isReadPing(ping) {
    return pingKind(ping) === CHAT_PING_KIND_READ;
}

function pingActors(ping, existing) {
    return {
        ...(existing?.actors || {}),
        [ping.pair.chatPK]: ping.pair.actor.publicKey,
        [ping.payload.senderChatPK]: ping.payload.actorPK,
    };
}

function chatFromPing(ping, entryId, existing, preview, userChatPK, ms) {
    const ts = timestampMs(ms, null) ?? timestampMs(existing?.ts, null) ?? timestampMs(preview?.ts, null) ?? 0;
    if (!ts) {
        return null;
    }
    const visiblePreview = preview || existing?.preview || null;
    const readMs = timestampMs(existing?.readMs, null);
    return {
        id: ping.pair.chatId,
        linkId: ping.pair.linkId,
        entryId,
        peerChatPK: ping.payload.senderChatPK,
        peerUid: existing?.peerUid || cleanText(ping.payload.senderUid) || null,
        actors: pingActors(ping, existing),
        settings: existing?.settings,
        saved: existing?.saved || null,
        readMs,
        preview: visiblePreview,
        ts,
        unseen: visiblePreview ? isChatUnseenForUser({ preview: visiblePreview, readMs }, userChatPK) : false,
    };
}

async function resolvePingUid(cloud, payload) {
    const senderChatPK = cleanText(payload?.senderChatPK);
    const claimedUid = cleanText(payload?.senderUid);
    if (!cloud || !senderChatPK) {
        return null;
    }
    if (claimedUid) {
        const peer = await cloud.peer.read(claimedUid).catch(() => null);
        if (cleanText(peer?.chatPK) !== senderChatPK) {
            throw new Error('ping sender uid mismatch');
        }
        return claimedUid;
    }
    const peer = await cloud.search.peer.byChatPK(senderChatPK).catch(() => null);
    return peer?.uid || null;
}

async function readPingMsg(cloud, userChatPK, userPrivKey, ping, actors) {
    const chatId = ping?.pair?.chatId;
    const messageId = cleanText(ping?.payload?.messageId);
    const peerChatPK = cleanText(ping?.payload?.senderChatPK);
    if (!cloud || !chatId || !messageId || !userChatPK || !userPrivKey || !peerChatPK) {
        return null;
    }
    const data = await cloud.chat.messages.read(chatId, messageId).catch(() => null);
    if (!data) {
        return null;
    }
    const message = await decryptMsg(data, userChatPK, userPrivKey, peerChatPK, { actors, chatId }).catch(() => null);
    const preview = normalizeChatPreview(data, message ? { ...message, id: data.id } : null);
    return preview && canRenderChatPreview(preview) ? preview : null;
}

async function savePing(cloud, uid, userChatPK, userPrivKey, ping, options = {}) {
    const chatId = ping?.pair?.chatId;
    if (!chatId || !cleanText(ping?.payload?.actorPK) || !cleanText(ping?.payload?.senderChatPK)) {
        return false;
    }

    const entryId = ownChatEntryId(userPrivKey, chatId);
    const existing = options.existing || await readExistingEntry(cloud, uid, userPrivKey, entryId);
    const peerUid = options.peerUid || await resolvePingUid(cloud, ping.payload);
    const actors = options.actors || pingActors(ping, existing);
    const hasPreview = Object.prototype.hasOwnProperty.call(options, 'preview');
    const preview = hasPreview ? options.preview : await readPingMsg(cloud, userChatPK, userPrivKey, ping, actors);
    const entry = makeOwnChatEntry(ping.pair, {
        peerUid: peerUid || existing?.peerUid,
        peerActorPK: ping.payload.actorPK || existing?.actors?.[ping.payload.senderChatPK],
        actors,
        settings: existing?.settings,
        preview: preview || existing?.preview,
        readMs: existing?.readMs,
    });
    const body = await sealOwnChatEntry(userPrivKey, entryId, entry);
    const record = { body };
    if (options.writeTs !== false) {
        record.tsMs = timestampMs(options.tsMs, null) ?? pingTsMs(ping, preview, Date.now());
    }
    await cloud.user.chats.write(uid, entryId, record);
    return true;
}

function chatWithReadPreview(existing, preview, userChatPK) {
    if (!existing?.id || !preview) {
        return null;
    }
    return {
        ...existing,
        preview,
        unseen: isChatUnseenForUser({ preview, readMs: existing.readMs }, userChatPK),
    };
}

function patchReadPingPreview(existing, receiptPreview, userChatPK) {
    if (!existing?.preview || !isReadReceiptMsg(receiptPreview)) {
        return null;
    }
    return withChatPreviewOpened(existing.preview, receiptPreview, receiptPreview?.ts, receiptPreview?.from || receiptPreview?.s, userChatPK);
}

export async function processInbox(cloud, uid, userChatPK, userPrivKey, options = {}) {
    if (!cloud || !uid || !userChatPK || !userPrivKey) {
        return false;
    }

    const inboxItems = await cloud.inbox.list(uid).catch(() => null);
    if (!inboxItems?.length) {
        return false;
    }

    const chatsById = new Map((options.currentChats || []).map((chat) => [chat.id, chat]));
    const opened = [];
    const invalidDocs = [];
    for (const pingDoc of inboxItems) {
        try {
            const ping = await openPing(userChatPK, userPrivKey, pingDoc);
            const chatId = ping?.pair?.chatId;
            if (!chatId) {
                invalidDocs.push(pingDoc);
                continue;
            }
            opened.push({ pingDoc, ping, chatId, ms: pingSortMs(pingDoc, ping) });
        } catch {
            invalidDocs.push(pingDoc);
        }
    }

    await Promise.all(invalidDocs.map((pingDoc) => cloud.inbox.delete(uid, pingDoc.id).catch(() => {})));

    const pingsByChat = new Map();
    for (const item of opened.sort((a, b) => a.ms - b.ms)) {
        let group = pingsByChat.get(item.chatId);
        if (!group) {
            group = {
                chatId: item.chatId,
                docs: [],
                message: null,
                read: null,
            };
            pingsByChat.set(item.chatId, group);
        }
        group.docs.push(item.pingDoc);
        if (isReadPing(item.ping)) {
            if (!group.read || item.ms > group.read.ms) {
                group.read = item;
            }
        } else if (!group.message || item.ms > group.message.ms) {
            group.message = item;
        }
    }

    const writes = await Promise.all([...pingsByChat.values()].map(async (group) => {
        try {
            let current = chatsById.get(group.chatId) || null;
            let wrote = false;
            let handled = false;

            if (group.message) {
                const item = group.message;
                const entryId = ownChatEntryId(userPrivKey, item.chatId);
                const actors = pingActors(item.ping, current);
                const existingMs = timestampMs(current?.preview?.ts, 0) ?? 0;
                const preview = existingMs >= item.ms ? current?.preview || null : await readPingMsg(cloud, userChatPK, userPrivKey, item.ping, actors);
                const chat = chatFromPing(item.ping, entryId, current, preview, userChatPK, item.ms);
                if (chat) {
                    current = chat;
                    chatsById.set(chat.id, chat);
                    options.onPingChat?.(chat);
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }

                wrote = await savePing(cloud, uid, userChatPK, userPrivKey, item.ping, {
                    existing: current,
                    actors,
                    preview,
                });
            }

            if (group.read) {
                const item = group.read;
                const entryId = ownChatEntryId(userPrivKey, item.chatId);
                const existing = current || await readExistingEntry(cloud, uid, userPrivKey, entryId);
                const actors = pingActors(item.ping, existing);
                const receiptPreview = await readPingMsg(cloud, userChatPK, userPrivKey, item.ping, actors);
                const openedPreview = patchReadPingPreview(existing, receiptPreview, userChatPK);
                const chat = chatWithReadPreview(current, openedPreview, userChatPK);
                handled = true;
                if (openedPreview) {
                    if (chat) {
                        current = chat;
                        chatsById.set(chat.id, chat);
                        options.onPingChat?.(chat);
                    }
                    const writeExisting = chat || existing;
                    wrote = await savePing(cloud, uid, userChatPK, userPrivKey, item.ping, {
                        existing: writeExisting,
                        actors,
                        preview: openedPreview,
                        writeTs: false,
                    }) || wrote;
                }
            }

            if (wrote || handled) {
                await Promise.all(group.docs.map((pingDoc) => cloud.inbox.delete(uid, pingDoc.id).catch(() => {})));
            }
            return wrote || handled;
        } catch (error) {
            options.onPingError?.(error, group);
            return false;
        }
    }));
    return writes.some(Boolean);
}
