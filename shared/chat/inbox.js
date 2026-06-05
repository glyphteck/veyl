import { canShowMsg, canStoreMsg, isControlMsg } from './messages.js';
import { makeOwnChatEntry, openOwnChatEntry, ownChatEntryId, sealOwnChatEntry } from './entry.js';
import { openPing } from './ping.js';
import { decryptMsg } from './messages/query.js';
import { isChatUnseenForUser } from './chats.js';
import { timestampMs } from '../utils/time.js';
import { cleanText } from '../utils/text.js';

function normalizeChatLastMsg(msgData, message) {
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

async function readExistingEntry(cloud, uid, userPrivKey, entryId) {
    const entry = await cloud.user.chats.read(uid, entryId).catch(() => null);
    if (!entry) {
        return null;
    }
    return openOwnChatEntry(userPrivKey, entryId, entry.body).catch(() => null);
}

function pingTsMs(ping, lastMsg, fallbackMs) {
    const ms = timestampMs(lastMsg?.ts, null) ?? timestampMs(ping?.payload?.ts, null) ?? fallbackMs;
    return Number.isFinite(ms) ? ms : Date.now();
}

function pingSortMs(pingDoc, ping) {
    const payloadMs = Number(ping?.payload?.ts);
    if (Number.isFinite(payloadMs)) {
        return payloadMs;
    }
    return timestampMs(pingDoc?.ts, 0) ?? 0;
}

function pingActors(ping, existing) {
    return {
        ...(existing?.actors || {}),
        [ping.pair.chatPK]: ping.pair.actor.publicKey,
        [ping.payload.senderChatPK]: ping.payload.actorPK,
    };
}

function chatFromPing(ping, entryId, existing, lastMsg, userChatPK, ms) {
    const ts = timestampMs(lastMsg?.ts, null) ?? timestampMs(existing?.lastMsg?.ts, null) ?? ms ?? timestampMs(existing?.ts, null) ?? 0;
    if (!ts) {
        return null;
    }
    const visibleLastMsg = lastMsg || existing?.lastMsg || null;
    const readMs = timestampMs(existing?.readMs, null);
    return {
        id: ping.pair.chatId,
        linkId: ping.pair.linkId,
        entryId,
        peerChatPK: ping.payload.senderChatPK,
        peerUid: existing?.peerUid || cleanText(ping.payload.senderUid) || null,
        actors: pingActors(ping, existing),
        settings: existing?.settings,
        readMs,
        lastMsg: visibleLastMsg,
        ts,
        unseen: visibleLastMsg ? isChatUnseenForUser({ lastMsg: visibleLastMsg, readMs }, userChatPK) : false,
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
    const lastMsg = normalizeChatLastMsg(data, message ? { ...message, id: data.id } : null);
    return lastMsg && canShowMsg(lastMsg) && !isControlMsg(lastMsg) ? lastMsg : null;
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
    const hasLastMsg = Object.prototype.hasOwnProperty.call(options, 'lastMsg');
    const lastMsg = hasLastMsg ? options.lastMsg : await readPingMsg(cloud, userChatPK, userPrivKey, ping, actors);
    const entry = makeOwnChatEntry(ping.pair, {
        peerUid: peerUid || existing?.peerUid,
        peerActorPK: ping.payload.actorPK || existing?.actors?.[ping.payload.senderChatPK],
        actors,
        settings: existing?.settings,
        lastMsg: lastMsg || existing?.lastMsg,
        readMs: existing?.readMs,
    });
    const body = await sealOwnChatEntry(userPrivKey, entryId, entry);
    await cloud.user.chats.write(uid, entryId, {
        body,
        tsMs: options.tsMs || pingTsMs(ping, lastMsg, Date.now()),
    });
    return true;
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

    const latestByChat = new Map();
    for (const item of opened.sort((a, b) => a.ms - b.ms)) {
        const current = latestByChat.get(item.chatId);
        if (!current || item.ms > current.ms) {
            latestByChat.set(item.chatId, {
                ...item,
                docs: [...(current?.docs || []), item.pingDoc],
            });
            continue;
        }
        current.docs.push(item.pingDoc);
    }

    const writes = await Promise.all([...latestByChat.values()].map(async (item) => {
        const existing = chatsById.get(item.chatId) || null;
        const entryId = ownChatEntryId(userPrivKey, item.chatId);
        const actors = pingActors(item.ping, existing);
        const existingMs = timestampMs(existing?.lastMsg?.ts, 0) ?? 0;
        const lastMsg = existingMs >= item.ms ? existing?.lastMsg || null : await readPingMsg(cloud, userChatPK, userPrivKey, item.ping, actors);
        const chat = chatFromPing(item.ping, entryId, existing, lastMsg, userChatPK, item.ms);
        if (chat) {
            chatsById.set(chat.id, chat);
            options.onPingChat?.(chat);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const wrote = await savePing(cloud, uid, userChatPK, userPrivKey, item.ping, {
            existing,
            actors,
            lastMsg,
        });
        if (wrote) {
            await Promise.all(item.docs.map((pingDoc) => cloud.inbox.delete(uid, pingDoc.id).catch(() => {})));
        }
        return wrote;
    }));
    return writes.some(Boolean);
}
