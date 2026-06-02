import { collection, deleteDoc, doc, getDocsFromServer, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { cleanBytes, toBytes32, toHex } from '../crypto/core.js';
import { deriveKey } from '../crypto/kdf.js';
import { canonicalBytes } from '../crypto/canonical.js';
import { sealJson, openJson } from '../crypto/box.js';
import { packBodyData, unpackBodyData } from '../crypto/pack.js';
import { getMessageKey } from './state.js';
import { savedMediaStayRef } from './messages.js';
import { cleanText } from '../utils/text.js';

export const CHAT_SAVED_VERSION = 1;

export function savedRecordId(chatPrivKey, chatId, messageKey) {
    const key = deriveKey(toBytes32(chatPrivKey, 'chat private key'), 'user-chat-saved-id-v1', [cleanText(chatId), cleanText(messageKey)], 16);
    try {
        return toHex(key);
    } finally {
        cleanBytes(key);
    }
}

function savedKey(chatPrivKey, savedId) {
    return deriveKey(toBytes32(chatPrivKey, 'chat private key'), 'user-chat-saved-v1', [savedId]);
}

function savedAad(savedId) {
    return canonicalBytes({ v: CHAT_SAVED_VERSION, savedId }, 'chat saved aad');
}

function savedSnapshot(message) {
    const { pending, failed, localUri, localData, reactions, ...snapshot } = message || {};
    return snapshot;
}

export async function sealSavedMessage(chatPrivKey, savedId, record) {
    const key = savedKey(chatPrivKey, savedId);
    try {
        const { nonce, ct } = await sealJson(key, { v: CHAT_SAVED_VERSION, ...record }, savedAad(savedId));
        return packBodyData(nonce, ct);
    } finally {
        cleanBytes(key);
    }
}

export async function openSavedMessage(chatPrivKey, savedId, body) {
    const key = savedKey(chatPrivKey, savedId);
    try {
        const { nonce, ct } = unpackBodyData(body);
        const record = await openJson(key, nonce, ct, savedAad(savedId));
        if (record?.v !== CHAT_SAVED_VERSION || !record?.chatId || !record?.messageKey) {
            throw new Error('invalid saved message');
        }
        return record;
    } finally {
        cleanBytes(key);
    }
}

export async function saveMessageRecord(db, uid, chatPrivKey, chatId, message) {
    const messageKey = getMessageKey(message);
    if (!db || !uid || !chatPrivKey || !chatId || !messageKey) {
        return false;
    }
    const savedId = savedRecordId(chatPrivKey, chatId, messageKey);
    const stay = savedMediaStayRef(message);
    const body = await sealSavedMessage(chatPrivKey, savedId, {
        chatId,
        messageKey,
        savedAt: Date.now(),
        snapshot: savedSnapshot(message),
        stay: stay || null,
    });
    await setDoc(doc(db, 'users', uid, 'savedMessages', savedId), {
        chatId,
        body,
        ts: serverTimestamp(),
    });
    return true;
}

export async function deleteSavedMessageRecord(db, uid, chatPrivKey, chatId, message) {
    const messageKey = getMessageKey(message);
    if (!db || !uid || !chatPrivKey || !chatId || !messageKey) {
        return false;
    }
    await deleteDoc(doc(db, 'users', uid, 'savedMessages', savedRecordId(chatPrivKey, chatId, messageKey)));
    return true;
}

export async function deleteSavedMessageKey(db, uid, chatPrivKey, chatId, messageKey) {
    const key = cleanText(messageKey);
    if (!db || !uid || !chatPrivKey || !chatId || !key) {
        return false;
    }
    await deleteDoc(doc(db, 'users', uid, 'savedMessages', savedRecordId(chatPrivKey, chatId, key)));
    return true;
}

async function savedRecordsFromDocs(chatPrivKey, docs) {
    const records = [];
    for (const docSnap of docs || []) {
        const record = await openSavedMessage(chatPrivKey, docSnap.id, docSnap.data()?.body).catch(() => null);
        if (record?.messageKey) {
            records.push({ ...record, id: docSnap.id });
        }
    }
    return records;
}

export function listenSavedMessageRecords(db, uid, chatPrivKey, chatId, onUpdate, onError) {
    if (!db || !uid || !chatPrivKey || !chatId) {
        onUpdate?.([]);
        return () => {};
    }

    let run = 0;
    return onSnapshot(
        query(collection(db, 'users', uid, 'savedMessages'), where('chatId', '==', chatId)),
        (snap) => {
            const runId = ++run;
            void savedRecordsFromDocs(chatPrivKey, snap.docs)
                .then((records) => {
                    if (runId === run) {
                        onUpdate?.(records);
                    }
                })
                .catch((error) => {
                    if (runId === run) {
                        onError?.(error);
                    }
                });
        },
        onError
    );
}

export async function collectSavedMediaStaysForChat(db, uid, chatPrivKey, chatId) {
    if (!db || !uid || !chatPrivKey || !chatId) {
        return [];
    }
    const snap = await getDocsFromServer(query(collection(db, 'users', uid, 'savedMessages'), where('chatId', '==', chatId))).catch(() => null);
    const stays = [];
    for (const record of await savedRecordsFromDocs(chatPrivKey, snap?.docs)) {
        if (record?.stay) {
            stays.push(record.stay);
        }
    }
    return stays;
}

export async function collectSavedMediaStaysForUser(db, uid, chatPrivKey) {
    if (!db || !uid || !chatPrivKey) {
        return [];
    }
    const snap = await getDocsFromServer(collection(db, 'users', uid, 'savedMessages')).catch(() => null);
    const stays = [];
    for (const record of await savedRecordsFromDocs(chatPrivKey, snap?.docs)) {
        if (record?.stay) {
            stays.push(record.stay);
        }
    }
    return stays;
}
