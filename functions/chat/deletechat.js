import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { randomBytes } from 'node:crypto';
import admin, { db, FieldValue, OK } from '../lib/admin.js';
import { HOUR_MS, MINUTE_MS, limitCallable, uidLimitKey } from '../lib/ratelimit.js';
import { loggedCall } from '../lib/actionlog.js';
import { chatMediaPath, cleanChatMediaMessageKey, setTemporaryHold } from './media.js';

const CHAT_ID_RE = /^[0-9a-f]{64}$/i;
const LINK_ID_RE = /^[0-9a-f]{64}$/i;
const ENTRY_ID_RE = /^[0-9a-f]{32}$/i;
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MESSAGE_DELETE_BATCH_SIZE = 400;
const MESSAGE_TTL_UPDATE_BATCH_SIZE = 400;
const MESSAGE_TTL_UPDATE_LIMIT = 100;
const CLEANUP_DOC_BATCH_SIZE = 300;
const CLEANUP_STORAGE_BATCH_SIZE = 100;
const CLEANUP_CHAT_LIMIT = 100;
const CHAT_CHECK_LIMIT = 100;
const DELETE_MARK_CONCURRENCY = 20;
const OWNER_ENTRY_WIPE_CONCURRENCY = 20;
const DELETE_CALL_CLEANUP_MS = 15_000;
const DEFAULT_MESSAGE_TTL_MS = 21 * 24 * 60 * 60 * 1000;

function cleanChatId(value) {
    const chatId = typeof value === 'string' ? value.trim() : '';
    if (!CHAT_ID_RE.test(chatId)) {
        throw new HttpsError('invalid-argument', 'bad chat');
    }
    return chatId.toLowerCase();
}

function cleanLinkId(value) {
    const linkId = typeof value === 'string' ? value.trim() : '';
    if (!LINK_ID_RE.test(linkId)) {
        throw new HttpsError('invalid-argument', 'bad link');
    }
    return linkId.toLowerCase();
}

function cleanOptionalLinkId(value) {
    const linkId = typeof value === 'string' ? value.trim() : '';
    if (!linkId) {
        return '';
    }
    return cleanLinkId(linkId);
}

function cleanEntryId(value) {
    const entryId = typeof value === 'string' ? value.trim() : '';
    if (!entryId) {
        return '';
    }
    if (!ENTRY_ID_RE.test(entryId)) {
        throw new HttpsError('invalid-argument', 'bad chat entry');
    }
    return entryId.toLowerCase();
}

function cleanMessageId(value) {
    const messageId = typeof value === 'string' ? value.trim() : '';
    if (!MESSAGE_ID_RE.test(messageId)) {
        throw new HttpsError('invalid-argument', 'bad message');
    }
    return messageId;
}

function cleanDeleteChatTargets(data) {
    const raw = Array.isArray(data?.chats) ? data.chats : [data];
    const targets = [];
    const seen = new Set();

    for (const item of raw) {
        const chatId = cleanChatId(typeof item === 'string' ? item : item?.chatId ?? item?.id);
        if (seen.has(chatId)) {
            continue;
        }
        seen.add(chatId);
        targets.push({
            chatId,
            linkId: cleanOptionalLinkId(item?.linkId),
            entryId: cleanEntryId(item?.entryId),
        });
    }

    return targets;
}

function cleanCheckChatIds(data) {
    const raw = Array.isArray(data?.chats) ? data.chats : Array.isArray(data?.chatIds) ? data.chatIds : data?.chatId ? [data.chatId] : [];
    const ids = [];
    const seen = new Set();

    for (const item of raw) {
        const chatId = cleanChatId(typeof item === 'string' ? item : item?.chatId ?? item?.id);
        if (seen.has(chatId)) {
            continue;
        }
        seen.add(chatId);
        ids.push(chatId);
        if (ids.length > CHAT_CHECK_LIMIT) {
            throw new HttpsError('invalid-argument', 'too many chats');
        }
    }

    return ids;
}

function cleanMediaKeys(value) {
    const list = Array.isArray(value) ? value : [];
    const keys = [];
    const seen = new Set();
    for (const item of list) {
        try {
            const key = cleanChatMediaMessageKey(item);
            if (!seen.has(key)) {
                seen.add(key);
                keys.push(key);
            }
        } catch {
            // Ignore invalid media keys so text-only deletes do not fail.
        }
    }
    return keys;
}

function cleanMessageTtlItems(value) {
    const list = Array.isArray(value) ? value : [];
    const items = [];
    const seen = new Set();
    for (const raw of list) {
        const id = cleanMessageId(raw?.id);
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        let mediaKey = '';
        if (raw?.mediaKey) {
            try {
                mediaKey = cleanChatMediaMessageKey(raw.mediaKey);
            } catch {
                mediaKey = '';
            }
        }
        items.push({ id, mediaKey });
        if (items.length >= MESSAGE_TTL_UPDATE_LIMIT) {
            break;
        }
    }
    return items;
}

function temporaryTtl(value) {
    const now = Date.now();
    const fallback = now + DEFAULT_MESSAGE_TTL_MS;
    const ms = Number(value);
    const ttlMs = Number.isFinite(ms) && ms > now && ms <= fallback + MINUTE_MS ? ms : fallback;
    return admin.firestore.Timestamp.fromMillis(ttlMs);
}

function garbageBody() {
    return admin.firestore.Bytes.fromUint8Array(randomBytes(64));
}

function isMissingError(error) {
    return error?.code === 404 || error?.code === 5 || error?.errors?.some?.((item) => item?.reason === 'notFound');
}

async function wipeOwnerEntry(uid, entryId) {
    if (!uid || !entryId) {
        return false;
    }
    const ref = db.collection('users').doc(uid).collection('chats').doc(entryId);
    await ref.set({
        body: garbageBody(),
        ts: FieldValue.serverTimestamp(),
    }, { merge: true }).catch((error) => {
        if (!isMissingError(error)) {
            throw error;
        }
    });
    await ref.delete().catch((error) => {
        if (!isMissingError(error)) {
            throw error;
        }
    });
    return true;
}

async function forEachChunk(items, size, fn) {
    for (let index = 0; index < items.length; index += size) {
        await Promise.all(items.slice(index, index + size).map(fn));
    }
}

async function markChatDeleted(chatId, linkId) {
    const now = FieldValue.serverTimestamp();
    const chatRef = db.collection('chats').doc(chatId);
    if (!linkId) {
        await chatRef.set({
            deleted: 'pending',
            updatedAt: now,
        }, { merge: true });
        return;
    }

    const linkRef = db.collection('links').doc(linkId);
    await db.runTransaction(async (tx) => {
        const linkSnap = await tx.get(linkRef);
        tx.set(chatRef, {
            deleted: 'pending',
            updatedAt: now,
        }, { merge: true });
        if (linkSnap.data()?.chat?.id === chatId) {
            tx.set(linkRef, {
                chat: {
                    id: null,
                    version: Number.isInteger(linkSnap.data()?.chat?.version) ? linkSnap.data().chat.version : 0,
                    ts: now,
                },
                updatedAt: now,
            }, { merge: true });
        }
    });
}

async function markChatsDeleted(targets) {
    await forEachChunk(targets, DELETE_MARK_CONCURRENCY, (target) => markChatDeleted(target.chatId, target.linkId));
}

async function wipeOwnerEntries(uid, targets) {
    await forEachChunk(
        targets.filter((target) => target.entryId),
        OWNER_ENTRY_WIPE_CONCURRENCY,
        (target) => wipeOwnerEntry(uid, target.entryId)
    );
}

async function deleteDocs(docs, batchSize = CLEANUP_DOC_BATCH_SIZE) {
    for (let index = 0; index < docs.length; index += batchSize) {
        const batch = db.batch();
        docs.slice(index, index + batchSize).forEach((docSnap) => batch.delete(docSnap.ref));
        await batch.commit();
    }
    return docs.length;
}

async function deleteQueryDocs(query, batchSize = CLEANUP_DOC_BATCH_SIZE) {
    const snap = await query.get();
    return deleteDocs(snap.docs || [], batchSize);
}

async function deleteStorageFile(path) {
    const file = admin.storage().bucket().file(path);
    await file.setMetadata({ temporaryHold: false }).catch((error) => {
        if (isMissingError(error)) {
            return;
        }
        throw error;
    });
    await file.delete({ ignoreNotFound: true }).catch((error) => {
        if (isMissingError(error)) {
            return;
        }
        throw error;
    });
}

async function deleteStoragePrefix(prefix, batchSize = CLEANUP_STORAGE_BATCH_SIZE) {
    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: batchSize }).catch((error) => {
        if (isMissingError(error)) {
            return [[]];
        }
        throw error;
    });
    await Promise.all((files || []).map((file) => file.setMetadata({ temporaryHold: false }).catch((error) => {
        if (isMissingError(error)) {
            return;
        }
        throw error;
    })));
    await Promise.all((files || []).map((file) => file.delete({ ignoreNotFound: true }).catch((error) => {
        if (isMissingError(error)) {
            return;
        }
        throw error;
    })));
    return files?.length || 0;
}

async function deleteMessageMedia(chatId, messageKey) {
    await deleteStorageFile(chatMediaPath(chatId, messageKey));
}

async function deleteMessageDocs(chatId, messageIds) {
    const refs = messageIds.map((messageId) => db.collection('chats').doc(chatId).collection('messages').doc(messageId));
    for (let index = 0; index < refs.length; index += MESSAGE_DELETE_BATCH_SIZE) {
        const batch = db.batch();
        refs.slice(index, index + MESSAGE_DELETE_BATCH_SIZE).forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
    return refs.length;
}

async function deleteMessageDocsForChat(chatId) {
    return deleteQueryDocs(db.collection('chats').doc(chatId).collection('messages').limit(CLEANUP_DOC_BATCH_SIZE), CLEANUP_DOC_BATCH_SIZE);
}

async function cleanupDeletedChat(chatId) {
    const counts = {
        messages: await deleteMessageDocsForChat(chatId),
        storage: await deleteStoragePrefix(`chat-media/${chatId}/`, CLEANUP_STORAGE_BATCH_SIZE),
    };
    const pending = counts.messages + counts.storage;

    if (pending > 0) {
        await db.collection('chats').doc(chatId).set({
            deleted: 'pending',
            lastCounts: counts,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { done: false, counts };
    }

    await db.collection('chats').doc(chatId).set({
        deleted: 'done',
        lastCounts: counts,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { done: true, counts };
}

async function cleanupDeletedChatSafe(chatId) {
    try {
        return await cleanupDeletedChat(chatId);
    } catch (error) {
        await db.collection('chats').doc(chatId).set({
            deleted: 'pending',
            error: String(error?.message || error).slice(0, 500),
            attempts: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }).catch(() => {});
        throw error;
    }
}

async function cleanupDeletedChatsBestEffort(chatIds, deadlineMs) {
    const pending = new Set(chatIds);
    const counts = {
        messages: 0,
        storage: 0,
    };
    let passes = 0;

    while (pending.size && Date.now() < deadlineMs) {
        let progressed = false;
        for (const chatId of [...pending]) {
            if (Date.now() >= deadlineMs) {
                break;
            }
            const result = await cleanupDeletedChatSafe(chatId).catch(() => null);
            passes += 1;
            if (!result) {
                continue;
            }
            progressed = true;
            for (const key of Object.keys(counts)) {
                counts[key] += result?.counts?.[key] || 0;
            }
            if (result.done) {
                pending.delete(chatId);
            }
        }
        if (!progressed) {
            break;
        }
    }

    return {
        done: pending.size === 0,
        pendingCount: pending.size,
        passes,
        counts,
    };
}

export const deleteChat = onCall(loggedCall('deleteChat', async (context) => {
    const uid = context.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }

    const targets = cleanDeleteChatTargets(context.data);
    if (!targets.length) {
        return { ...OK, deleted: 0 };
    }

    const deadlineMs = Date.now() + DELETE_CALL_CLEANUP_MS;
    const shouldCleanup = context.data?.cleanup !== false;

    await markChatsDeleted(targets);
    await wipeOwnerEntries(uid, targets);
    const cleanup = shouldCleanup ? await cleanupDeletedChatsBestEffort(targets.map((target) => target.chatId), deadlineMs).catch(() => null) : null;

    return { ...OK, deleted: targets.length, cleanup };
}));

export const checkChats = onCall(loggedCall('checkChats', async (context) => {
    const uid = context.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }

    const chatIds = cleanCheckChatIds(context.data);
    if (!chatIds.length) {
        return { ...OK, chats: [] };
    }

    const refs = chatIds.map((chatId) => db.collection('chats').doc(chatId));
    const snaps = await db.getAll(...refs);
    return {
        ...OK,
        chats: snaps.map((snap, index) => ({
            chatId: chatIds[index],
            active: !(snap.data()?.deleted),
        })),
    };
}));

async function setMediaHolds(chatId, mediaKeys, hold, options = {}) {
    const updated = [];
    for (const messageKey of mediaKeys) {
        await setTemporaryHold(chatMediaPath(chatId, messageKey), hold, options);
        updated.push(messageKey);
    }
    return updated;
}

async function updateMessageTtlDocs(chatId, items, ttl) {
    if (!items.length) {
        return 0;
    }
    const refs = items.map((item) => db.collection('chats').doc(chatId).collection('messages').doc(item.id));
    for (let index = 0; index < refs.length; index += MESSAGE_TTL_UPDATE_BATCH_SIZE) {
        const batch = db.batch();
        refs.slice(index, index + MESSAGE_TTL_UPDATE_BATCH_SIZE).forEach((ref) => batch.update(ref, { ttl }));
        await batch.commit();
    }
    return refs.length;
}

async function existingTtlItems(chatId, items) {
    const refs = items.map((item) => db.collection('chats').doc(chatId).collection('messages').doc(item.id));
    const snaps = await db.getAll(...refs);
    const existing = [];
    snaps.forEach((snap, index) => {
        if (snap.exists) {
            existing.push({
                ...items[index],
                ttl: snap.data()?.ttl ?? null,
            });
        }
    });
    return existing;
}

async function assertChatWritable(chatId) {
    const snap = await db.collection('chats').doc(chatId).get();
    if (snap.data()?.deleted) {
        throw new HttpsError('failed-precondition', 'chat deleted');
    }
}

export const setChatMessageTtl = onCall(loggedCall('setChatMessageTtl', async (context) => {
    const uid = context.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }
    await limitCallable(context, [
        { name: 'set-chat-message-ttl-uid-minute', key: uidLimitKey(uid, 'set-chat-message-ttl'), limit: 120, windowMs: MINUTE_MS },
        { name: 'set-chat-message-ttl-uid-hour', key: uidLimitKey(uid, 'set-chat-message-ttl'), limit: 1200, windowMs: HOUR_MS },
    ]);

    const chatId = cleanChatId(context.data?.chatId);
    const items = cleanMessageTtlItems(context.data?.messages);
    if (!items.length) {
        return { ...OK, updated: 0 };
    }

    await assertChatWritable(chatId);
    const existing = await existingTtlItems(chatId, items);
    const currentPermanent = (item) => item.ttl == null;
    if (context.data?.permanent === true) {
        const updates = existing.filter((item) => !currentPermanent(item));
        const mediaKeys = updates.map((item) => item.mediaKey).filter(Boolean);
        let held = [];
        try {
            held = await setMediaHolds(chatId, mediaKeys, true);
            const updated = await updateMessageTtlDocs(chatId, updates, null);
            return { ...OK, updated };
        } catch (error) {
            await setMediaHolds(chatId, held, false, { ignoreMissing: true }).catch(() => {});
            throw error;
        }
    }

    const updates = existing.filter(currentPermanent);
    const updated = await updateMessageTtlDocs(chatId, updates, temporaryTtl(context.data?.ttlMs));
    await setMediaHolds(chatId, updates.map((item) => item.mediaKey).filter(Boolean), false, { ignoreMissing: true });
    return { ...OK, updated };
}));

export const deleteChatMessage = onCall(loggedCall('deleteChatMessage', async (context) => {
    const uid = context.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }
    await limitCallable(context, [
        { name: 'delete-chat-message-uid-minute', key: uidLimitKey(uid, 'delete-chat-message'), limit: 120, windowMs: MINUTE_MS },
        { name: 'delete-chat-message-uid-hour', key: uidLimitKey(uid, 'delete-chat-message'), limit: 1200, windowMs: HOUR_MS },
    ]);

    const chatId = cleanChatId(context.data?.chatId);
    const messageId = cleanMessageId(context.data?.messageId);
    const mediaKeys = cleanMediaKeys(context.data?.mediaKeys);

    await Promise.all(mediaKeys.map((messageKey) => deleteMessageMedia(chatId, messageKey)));
    await deleteMessageDocs(chatId, [messageId]);

    return OK;
}));

export const deleteChatMessages = onCall(loggedCall('deleteChatMessages', async (context) => {
    const uid = context.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'auth');
    }
    await limitCallable(context, [
        { name: 'delete-chat-messages-uid-minute', key: uidLimitKey(uid, 'delete-chat-messages'), limit: 90, windowMs: MINUTE_MS },
        { name: 'delete-chat-messages-uid-hour', key: uidLimitKey(uid, 'delete-chat-messages'), limit: 600, windowMs: HOUR_MS },
    ]);

    const chatId = cleanChatId(context.data?.chatId);
    const messageIds = [...new Set((Array.isArray(context.data?.messageIds) ? context.data.messageIds : []).map(cleanMessageId))];
    const mediaKeys = cleanMediaKeys(context.data?.mediaKeys);

    if (!messageIds.length) {
        return { ...OK, deleted: 0 };
    }

    await Promise.all(mediaKeys.map((messageKey) => deleteMessageMedia(chatId, messageKey)));
    const deleted = await deleteMessageDocs(chatId, messageIds);

    return { ...OK, deleted };
}));

export const cleanupDeletedChats = onSchedule({ schedule: '17 3 * * *', timeZone: 'America/Los_Angeles', timeoutSeconds: 300, maxInstances: 1 }, async () => {
    const snap = await db.collection('chats').where('deleted', '==', 'pending').limit(CLEANUP_CHAT_LIMIT).get();
    for (const docSnap of snap.docs || []) {
        await cleanupDeletedChatSafe(docSnap.id).catch(() => {});
    }
});
