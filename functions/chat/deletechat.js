import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { randomBytes } from 'node:crypto';
import admin, { db, FieldValue, OK } from '../lib/admin.js';
import { loggedCall } from '../lib/actionlog.js';

const CHAT_ID_RE = /^[0-9a-f]{64}$/i;
const LINK_ID_RE = /^[0-9a-f]{64}$/i;
const ENTRY_ID_RE = /^[0-9a-f]{32}$/i;
const CLEANUP_DOC_BATCH_SIZE = 300;
const CLEANUP_STORAGE_BATCH_SIZE = 100;
const CLEANUP_CHAT_LIMIT = 100;
const DELETE_MARK_CONCURRENCY = 20;
const OWNER_ENTRY_WIPE_CONCURRENCY = 20;
const DELETE_CALL_CLEANUP_MS = 15_000;

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

function garbageBody() {
    return randomBytes(64);
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

async function deleteMessageDocsForChat(chatId) {
    return deleteQueryDocs(db.collection('chats').doc(chatId).collection('messages').limit(CLEANUP_DOC_BATCH_SIZE), CLEANUP_DOC_BATCH_SIZE);
}

async function cleanupDeletedChat(chatId) {
    const counts = {
        messages: await deleteMessageDocsForChat(chatId),
        storage: await deleteStoragePrefix(`chats/${chatId}/`, CLEANUP_STORAGE_BATCH_SIZE),
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

export const cleanupDeletedChats = onSchedule({ schedule: '17 3 * * *', timeZone: 'America/Los_Angeles', timeoutSeconds: 300, maxInstances: 1 }, async () => {
    const snap = await db.collection('chats').where('deleted', '==', 'pending').limit(CLEANUP_CHAT_LIMIT).get();
    for (const docSnap of snap.docs || []) {
        await cleanupDeletedChatSafe(docSnap.id).catch(() => {});
    }
});
