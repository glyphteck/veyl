import { Bytes, collection, deleteDoc, deleteField, doc, documentId, endBefore, getDoc, getDocFromServer, getDocs, getDocsFromServer, limit, limitToLast, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, startAt, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged, signInWithCustomToken, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { deleteObject, getBytes, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { avatarUrlWithVersion } from '../avatar.js';
import { getChatMediaFileRef } from '../chat/filepayload.js';
import { COMMUNITY_RULES_DATE, COMMUNITY_RULES_VERSION, hasCurrentCommunityRules } from '../community.js';
import { CHAT_INBOX_PING_PAGE_SIZE, CHAT_LIST_PAGE_SIZE, CHAT_MESSAGE_BATCH_SIZE, SEARCH_ROLE_LIMIT, SEARCH_USERNAME_LIMIT } from '../config.js';
import { toBytes } from '../crypto/core.js';
import { firebaseConfig } from '../firebaseconfig.js';
import { getRole } from '../search/roles.js';
import { defaultSettings, normalizeSettings } from '../settings.js';
import { openSettings, sealSettings } from '../settingscloud.js';
import { positiveInt } from '../utils/number.js';
import { timestampMs } from '../utils/time.js';
import { walletPKField } from '../wallet/keys.js';

function requireUid(uid) {
    if (!uid) {
        throw new Error('uid required');
    }
}

function recordFromDoc(snap) {
    return snap?.exists?.() ? { ...snap.data(), id: snap.id } : null;
}

function recordsFromSnapshot(snapshot) {
    return snapshot.docs
        .map(recordFromDoc)
        .filter(Boolean);
}

function peerRecordFromDoc(snap) {
    const record = recordFromDoc(snap);
    return record ? { ...record, uid: snap.id } : null;
}

function peerRecordsFromSnapshot(snapshot) {
    return snapshot.docs
        .map(peerRecordFromDoc)
        .filter(Boolean);
}

function avatarPath(uid) {
    requireUid(uid);
    return `${uid}/avatar.webp`;
}

function reportEvidencePath(reporter, targetUid, evidenceId) {
    if (!reporter || !targetUid || !evidenceId) {
        throw new Error('report evidence path parts required');
    }
    return `reports/${reporter}/${targetUid}/${evidenceId}`;
}

function isReactNative() {
    return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
}

function encryptedBytes(value, label = 'encrypted bytes') {
    if (value == null || typeof value === 'string') {
        throw new Error(`Invalid ${label}`);
    }
    if (typeof value?.toUint8Array === 'function') {
        return value.toUint8Array();
    }
    return toBytes(value, label);
}

function isCloudBytes(value) {
    return value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value) || typeof value?.toUint8Array === 'function';
}

function readCloudBytes(value, label = 'encrypted bytes') {
    return value == null ? null : encryptedBytes(value, label);
}

function writeCloudBytes(value, label = 'encrypted bytes') {
    return Bytes.fromUint8Array(encryptedBytes(value, label));
}

function bytesBase64(bytes) {
    const source = encryptedBytes(bytes, 'base64 bytes');
    let binary = '';
    for (let index = 0; index < source.length; index += 1) {
        binary += String.fromCharCode(source[index]);
    }
    if (typeof btoa === 'function') {
        return btoa(binary);
    }
    if (typeof globalThis.Buffer?.from === 'function') {
        return globalThis.Buffer.from(source).toString('base64');
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let index = 0; index < source.length; index += 3) {
        const a = source[index];
        const b = index + 1 < source.length ? source[index + 1] : 0;
        const c = index + 2 < source.length ? source[index + 2] : 0;
        out += alphabet[a >> 2];
        out += alphabet[((a & 3) << 4) | (b >> 4)];
        out += index + 1 < source.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=';
        out += index + 2 < source.length ? alphabet[c & 63] : '=';
    }
    return out;
}

function cloudBytesBase64(value, label = 'encrypted bytes') {
    return bytesBase64(encryptedBytes(value, label));
}

function decodeBodyRecord(record, label = 'encrypted body') {
    if (!record || record.body == null) {
        return record;
    }
    return { ...record, body: readCloudBytes(record.body, label) };
}

export function createFirebaseCloud({ db, auth, getAuth, functions, getFunctions, storage, getStorage, uploadStorageBytes, uploadSignedStorageBytes }) {
    if (!db) {
        throw new Error('createFirebaseCloud requires db');
    }

    function pageTs(value) {
        if (typeof value?.toMillis === 'function') {
            return value;
        }
        if (Number.isFinite(value?.seconds)) {
            return new Timestamp(value.seconds, value.nanoseconds || 0);
        }
        const ms = timestampMs(value, null);
        return Number.isFinite(ms) ? Timestamp.fromMillis(ms) : null;
    }

    function pageMarker(value) {
        const ts = pageTs(value?.ts);
        return ts && typeof value?.id === 'string' && value.id ? { ts, id: value.id } : null;
    }

    function pageMarkerFromDoc(snap) {
        return snap?.exists?.() ? pageMarker({ id: snap.id, ts: snap.data()?.ts ?? null }) : null;
    }

    function messageRecordKeys(record) {
        const keys = [];
        if (record?.id) {
            keys.push(record.id);
        }
        const cid = record?.head?.cid;
        if (typeof cid === 'string' && cid) {
            keys.push(cid);
        }
        return keys;
    }

    function messageRecordTtlExpired(record, now = Date.now()) {
        const ttlMs = timestampMs(record?.ttl, null);
        return ttlMs != null && ttlMs <= now;
    }

    function resolveFunctions() {
        return typeof getFunctions === 'function' ? getFunctions() : functions;
    }

    function resolveAuth() {
        return typeof getAuth === 'function' ? getAuth() : auth;
    }

    function requireAuth() {
        const targetAuth = resolveAuth();
        if (!targetAuth) throw new Error('createFirebaseCloud requires auth');
        return targetAuth;
    }

    function resolveStorage() {
        return typeof getStorage === 'function' ? getStorage() : storage;
    }

    function requireStorage() {
        const targetStorage = resolveStorage();
        if (!targetStorage) throw new Error('createFirebaseCloud requires storage');
        return targetStorage;
    }

    function uploadByteSize(data) {
        if (Number.isFinite(data?.byteLength)) {
            return data.byteLength;
        }
        if (Number.isFinite(data?.size)) {
            return data.size;
        }
        return toBytes(data, 'upload bytes').byteLength;
    }

    async function uploadStorageFile(path, data, metadata = {}) {
        const targetStorage = requireStorage();
        if (typeof uploadStorageBytes === 'function') {
            await uploadStorageBytes(targetStorage, path, data, metadata);
            return true;
        }
        const payload = typeof Blob !== 'undefined' && data instanceof Blob ? data : toBytes(data, 'upload bytes');
        await uploadBytes(ref(targetStorage, path), payload, metadata);
        return true;
    }

    async function uploadSignedStorageFile(upload, signed = {}) {
        const url = signed?.url || signed?.uploadUrl;
        if (!url) {
            throw new Error('signed upload url required');
        }
        const method = signed?.method || 'PUT';
        const headers = signed?.headers || {
            'Content-Type': upload?.metadata?.contentType || 'application/octet-stream',
        };
        if (typeof uploadSignedStorageBytes === 'function') {
            await uploadSignedStorageBytes(url, upload?.body, { ...signed, method, headers, metadata: upload?.metadata || {}, path: upload?.path || '' });
            return true;
        }
        const payload = typeof Blob !== 'undefined' && upload?.body instanceof Blob ? upload.body : toBytes(upload?.body, 'upload bytes');
        const response = await fetch(url, {
            method,
            headers,
            body: payload,
        });
        if (!response.ok) {
            const error = new Error(`signed upload failed (${response.status || 0})`);
            error.status = response.status || 0;
            error.stage = 'upload';
            error.responseText = await response.text().catch(() => '');
            throw error;
        }
        return true;
    }

    async function readStorageFile(path) {
        const targetStorage = requireStorage();
        try {
            return new Uint8Array(await getBytes(ref(targetStorage, path)));
        } catch (error) {
            if (!isReactNative()) {
                error.path = path;
                error.stage = 'getBytes';
                throw error;
            }
        }

        try {
            const url = await getDownloadURL(ref(targetStorage, path));
            const res = await fetch(url);
            if (!res.ok) {
                const error = new Error(`download failed (${res.status})`);
                error.status = res.status;
                throw error;
            }
            return new Uint8Array(await res.arrayBuffer());
        } catch (error) {
            error.path = path;
            error.stage = error?.stage || 'fetch';
            throw error;
        }
    }

    async function callFunction(name, payload) {
        const targetFunctions = resolveFunctions();
        if (!targetFunctions) {
            throw new Error('createFirebaseCloud requires functions');
        }
        const result = await httpsCallable(targetFunctions, name)(payload);
        return result?.data ?? null;
    }

    function httpFunctionUrl(name) {
        const targetFunctions = resolveFunctions();
        const app = targetFunctions?.app || resolveAuth()?.app || resolveStorage()?.app || null;
        const projectId = app?.options?.projectId || firebaseConfig.projectId;
        const region = targetFunctions?.region || targetFunctions?._region || 'us-central1';
        if (!projectId) {
            throw new Error('firebase project required');
        }
        return `https://${region}-${projectId}.cloudfunctions.net/${name}`;
    }

    async function callHttpFunction(name, payload) {
        const response = await fetch(httpFunctionUrl(name), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.ok === false) {
            const error = new Error(data?.message || `function request failed (${response.status || 0})`);
            error.code = data?.code || '';
            error.status = response.status || 0;
            throw error;
        }
        return data || null;
    }

    async function finishAuth(name, payload) {
        const data = await callFunction(name, payload);
        if (data?.token) {
            await signInWithCustomToken(requireAuth(), data.token);
        }
        return data;
    }

    function watchAuth(onUpdate, onError) {
        return onAuthStateChanged(requireAuth(), onUpdate, onError);
    }

    async function logout() {
        await signOut(requireAuth());
        return true;
    }

    async function logoutDevices() {
        await callFunction('logoutDevices');
        return true;
    }

    async function readOnboarding(uid) {
        requireUid(uid);

        const [profileDoc, seedDoc, userDoc] = await Promise.all([
            getDoc(doc(db, 'profiles', uid)),
            getDoc(doc(db, 'seeds', uid)),
            getDoc(doc(db, 'users', uid)),
        ]);
        const profile = profileDoc.exists() ? profileDoc.data() : null;
        const user = userDoc.exists() ? userDoc.data() : null;

        return {
            uid,
            hasUsername: !!profile?.username,
            hasAvatarEntry: !!profile && Object.prototype.hasOwnProperty.call(profile, 'avatar'),
            hasVault: seedDoc.exists(),
            communityRulesVersion: user?.communityRulesVersion || null,
            communityRulesDate: user?.communityRulesDate || null,
            communityRulesAcceptedAt: user?.communityRulesAcceptedAt || null,
            hasCurrentCommunityRules: hasCurrentCommunityRules(user),
        };
    }

    async function isAdmin(uid) {
        if (!uid) return false;
        const snap = await getDoc(doc(db, 'admins', uid));
        return snap.exists();
    }

    function watchAdmin(uid, onUpdate, onError) {
        requireUid(uid);
        return onSnapshot(
            doc(db, 'admins', uid),
            (snap) => {
                onUpdate?.(snap.exists());
            },
            onError
        );
    }

    async function readVault(uid) {
        requireUid(uid);
        const snap = await getDoc(doc(db, 'seeds', uid));
        return readCloudBytes(snap.data()?.es ?? null, 'vault bytes');
    }

    async function vaultExists(uid) {
        requireUid(uid);
        const snap = await getDoc(doc(db, 'seeds', uid));
        return snap.exists();
    }

    async function writeVault(uid, vault) {
        requireUid(uid);
        if (!vault) {
            throw new Error('vault required');
        }
        await setDoc(doc(db, 'seeds', uid), { es: writeCloudBytes(vault, 'vault bytes') });
        return true;
    }

    async function replaceVault(uid, { vault, expectedHash, from, to, walletPK, chatPK, network } = {}) {
        requireUid(uid);
        if (!vault || !expectedHash || !from || !to) {
            throw new Error('vault replacement required');
        }
        await callFunction('replaceVault', {
            expectedHash,
            from,
            to,
            vault: cloudBytesBase64(vault, 'vault bytes'),
            walletPK: walletPK || null,
            chatPK: chatPK || null,
            network: network || null,
        });
        return true;
    }

    function watchVault(uid, onUpdate, onError) {
        requireUid(uid);
        return onSnapshot(
            doc(db, 'seeds', uid),
            (snap) => {
                onUpdate?.(readCloudBytes(snap.data()?.es ?? null, 'vault bytes'), { exists: snap.exists() });
            },
            onError
        );
    }

    async function acceptCommunity(uid, { version = COMMUNITY_RULES_VERSION, date = COMMUNITY_RULES_DATE } = {}) {
        requireUid(uid);
        const payload = {
            communityRulesVersion: version,
            communityRulesAcceptedAt: serverTimestamp(),
        };
        if (date) {
            payload.communityRulesDate = date;
        }
        await setDoc(
            doc(db, 'users', uid),
            payload,
            { merge: true }
        );
        return true;
    }

    async function writeProfileAvatar(uid, avatar) {
        requireUid(uid);
        await updateDoc(doc(db, 'profiles', uid), { avatar });
        return true;
    }

    async function uploadProfileAvatar(uid, data, { contentType = 'image/webp' } = {}) {
        const targetStorage = requireStorage();
        const path = avatarPath(uid);
        const result = typeof uploadStorageBytes === 'function'
            ? await uploadStorageBytes(targetStorage, path, data, { contentType })
            : await uploadBytes(
                ref(targetStorage, path),
                typeof Blob !== 'undefined' && data instanceof Blob ? data : toBytes(data, 'upload bytes'),
                { contentType }
            );
        const url = await getDownloadURL(ref(targetStorage, path));
        return {
            url,
            generation: result?.metadata?.generation ?? result?.generation ?? null,
        };
    }

    async function deleteProfileAvatar(uid) {
        const targetStorage = requireStorage();
        await deleteObject(ref(targetStorage, avatarPath(uid)));
        return true;
    }

    async function writeProfileWalletPK(walletPK, { network } = {}) {
        if (!walletPK) throw new Error('wallet public key required');
        await callFunction('setWalletPK', { walletPK, network });
        return true;
    }

    async function writeProfileChatPK(chatPK) {
        if (!chatPK) throw new Error('chat public key required');
        await callFunction('setChatPK', { chatPK });
        return true;
    }

    async function getUsername(username) {
        if (!username) throw new Error('username required');
        await callFunction('setUsername', { username });
        await requireAuth().currentUser?.getIdToken?.(true);
        return true;
    }

    async function deleteUser() {
        await callFunction('deleteAccount');
        return true;
    }

    function watchProfile(uid, onUpdate, onError) {
        requireUid(uid);
        return onSnapshot(
            doc(db, 'profiles', uid),
            (snap) => {
                onUpdate?.(snap.exists() ? snap.data() : {}, { exists: snap.exists() });
            },
            onError
        );
    }

    function watchPrivate(uid, onUpdate, onError) {
        requireUid(uid);
        return onSnapshot(
            doc(db, 'users', uid),
            { includeMetadataChanges: true },
            (snap) => {
                onUpdate?.(snap.exists() ? snap.data() : {}, {
                    exists: snap.exists(),
                    fromCache: snap.metadata.fromCache,
                    pending: snap.metadata.hasPendingWrites,
                });
            },
            onError
        );
    }

    function watchUserBanned(uid, onUpdate, onError) {
        requireUid(uid);
        return onSnapshot(
            doc(db, 'moderation', uid),
            (snap) => {
                const data = snap.exists() ? snap.data() : {};
                onUpdate?.(data?.banned ?? null, { exists: snap.exists() });
            },
            onError
        );
    }

    async function readSettings(uid, key) {
        requireUid(uid);
        if (!key) {
            throw new Error('settings key required');
        }
        const snap = await getDoc(doc(db, 'users', uid));
        const saved = snap.data()?.settings ?? null;
        if (saved != null) {
            if (!isCloudBytes(saved)) {
                throw new Error('unsupported settings body');
            }
            return openSettings(key, uid, readCloudBytes(saved, 'settings body'));
        }
        const settings = normalizeSettings(defaultSettings);
        await setDoc(
            doc(db, 'users', uid),
            {
                settings: writeCloudBytes(await sealSettings(key, uid, settings), 'settings body'),
            },
            { merge: true }
        );
        return settings;
    }

    async function writeSettings(uid, settings, { currentSettings, key } = {}) {
        requireUid(uid);
        if (!key) {
            throw new Error('settings key required');
        }

        const base = currentSettings || (await readSettings(uid, key));
        const nextSettings = normalizeSettings(settings, base);
        const body = await sealSettings(key, uid, nextSettings);

        await setDoc(
            doc(db, 'users', uid),
            {
                settings: writeCloudBytes(body, 'settings body'),
            },
            { merge: true }
        );

        return nextSettings;
    }

    async function writeUserActive(uid, active) {
        requireUid(uid);
        const ref = doc(db, 'profiles', uid);

        if (active) {
            await setDoc(ref, { active: true }, { merge: true });
            return true;
        }

        try {
            await updateDoc(ref, { active: false });
            return true;
        } catch (error) {
            if (error?.code === 'not-found') {
                return false;
            }
            throw error;
        }
    }

    async function addUserPush(payload = {}) {
        await callFunction('setPush', payload);
        return true;
    }

    async function dropUserPush(payload = {}) {
        await callFunction('dropPush', payload);
        return true;
    }

    async function addBlocked(uid, peerUid) {
        requireUid(uid);
        requireUid(peerUid);
        await setDoc(doc(db, 'users', uid, 'blocked', peerUid), {});
        return true;
    }

    async function removeBlocked(uid, peerUid) {
        requireUid(uid);
        requireUid(peerUid);
        await deleteDoc(doc(db, 'users', uid, 'blocked', peerUid));
        return true;
    }

    function watchBlocked(uid, onUpdate, onError) {
        requireUid(uid);
        return onSnapshot(
            collection(db, 'users', uid, 'blocked'),
            (snap) => {
                const blocked = snap.docs
                    .map((item) => item.id)
                    .filter(Boolean)
                    .sort();
                onUpdate?.(blocked);
            },
            onError
        );
    }

    function watchBitcoin(onUpdate, onError) {
        return onSnapshot(
            doc(db, 'bitcoin', 'current'),
            (snap) => {
                onUpdate?.(snap.exists() ? snap.data() : null, { exists: snap.exists() });
            },
            onError
        );
    }

    async function readPeer(uid) {
        requireUid(uid);
        const snap = await getDoc(doc(db, 'profiles', uid));
        return peerRecordFromDoc(snap);
    }

    async function readPeerActive(uid) {
        requireUid(uid);
        const snap = await getDoc(doc(db, 'profiles', uid));
        return snap.exists() ? snap.data()?.active === true : false;
    }

    function watchPeerActive(uid, onUpdate, onError) {
        requireUid(uid);
        return onSnapshot(
            doc(db, 'profiles', uid),
            (snap) => {
                onUpdate?.(snap.exists() ? snap.data()?.active === true : false, { exists: snap.exists() });
            },
            onError
        );
    }


    async function readPeerAvatar(uid) {
        return readStorageFile(avatarPath(uid));
    }

    async function peerAvatarUrl(uid, { version = null } = {}) {
        const targetStorage = requireStorage();
        const url = await getDownloadURL(ref(targetStorage, avatarPath(uid)));
        return avatarUrlWithVersion(url, version);
    }

    function profileQueryField(field, { network } = {}) {
        if (field === 'walletPK') {
            return walletPKField(network);
        }
        if (field === 'chatPK' || field === 'username') {
            return field;
        }
        throw new Error('bad peer search field');
    }

    async function searchPeerByField(field, value, options = {}) {
        if (!value) return null;
        const snapshot = await getDocs(query(collection(db, 'profiles'), where(profileQueryField(field, options), '==', value), limit(1)));
        return peerRecordFromDoc(snapshot.docs[0]);
    }

    async function searchPeerByFields(field, values, options = {}) {
        const keys = Array.isArray(values) ? values.filter(Boolean) : [];
        if (!keys.length) return [];

        const queryField = profileQueryField(field, options);
        const jobs = [];
        for (let i = 0; i < keys.length; i += 10) {
            const chunk = keys.slice(i, i + 10);
            jobs.push(getDocs(query(collection(db, 'profiles'), where(queryField, 'in', chunk), limit(chunk.length))));
        }

        const snapshots = await Promise.all(jobs);
        return snapshots.flatMap(peerRecordsFromSnapshot);
    }

    async function searchPeerByUsernamePrefix(value) {
        if (!value) return [];
        const snapshot = await getDocs(
            query(
                collection(db, 'profiles'),
                where('username', '>=', value),
                where('username', '<=', value + '\uf8ff'),
                orderBy('username'),
                limit(SEARCH_USERNAME_LIMIT)
            )
        );
        return peerRecordsFromSnapshot(snapshot);
    }

    async function searchPeerByRole(roleId) {
        const role = getRole(roleId);
        if (!role) return [];

        let roleQuery = null;
        if (role.id === 'bots') {
            roleQuery = query(collection(db, 'profiles'), where('bot', '!=', false), limit(SEARCH_ROLE_LIMIT));
        } else if (role.id === 'active') {
            roleQuery = query(collection(db, 'profiles'), where('active', '==', true), limit(SEARCH_ROLE_LIMIT));
        }

        if (!roleQuery) return [];
        const snapshot = await getDocs(roleQuery);
        return peerRecordsFromSnapshot(snapshot);
    }

    async function uploadChatMedia(upload) {
        const path = upload?.path;
        if (!path) throw new Error('media path required');
        getChatMediaFileRef(path);
        await uploadStorageFile(path, upload?.body, upload?.metadata || {});
        return true;
    }

    async function uploadSharedMedia(upload) {
        const path = upload?.path;
        if (!path) throw new Error('shared media path required');
        const signed = await callFunction('reserveSharedMediaUpload', {
            sharedId: upload?.sharedId,
            path,
            size: uploadByteSize(upload?.body),
            contentType: upload?.metadata?.contentType || 'application/octet-stream',
        });
        await uploadSignedStorageFile(upload, signed?.upload);
        return true;
    }

    async function readChatMedia(path) {
        if (!path) throw new Error('media path required');
        return readStorageFile(path);
    }

    function chatMediaDeletePath(chatId, path) {
        if (!chatId) throw new Error('chat id required');
        const mediaRef = getChatMediaFileRef(path);
        if (mediaRef.chatId !== chatId) {
            throw new Error('media chat mismatch');
        }
        return path;
    }

    async function deleteChatMedia(chatId, path) {
        const targetStorage = requireStorage();
        await deleteObject(ref(targetStorage, chatMediaDeletePath(chatId, path))).catch((error) => {
            if (error?.code === 'storage/object-not-found') {
                return;
            }
            throw error;
        });
        return true;
    }

    async function setChatMediaHold(chatId, path, hold) {
        await callHttpFunction('setChatMediaHold', {
            path: chatMediaDeletePath(chatId, path),
            hold: hold === true,
        });
        return true;
    }

    function cleanChatDeleteTargets(value, options = {}) {
        const list = Array.isArray(value) ? value : [{ chatId: value, ...options }];
        const targets = [];
        const seen = new Set();

        for (const item of list) {
            const chatId = typeof item === 'string' ? item : (item?.chatId || item?.id || '');
            if (!chatId || seen.has(chatId)) {
                continue;
            }
            seen.add(chatId);
            targets.push({
                chatId,
                ...(item?.entryId ? { entryId: item.entryId } : {}),
                ...(item?.linkId ? { linkId: item.linkId } : {}),
            });
        }

        return targets;
    }

    async function deleteChat(chatId, options = {}) {
        const { entryId, linkId, cleanup = true } = options || {};
        if (Array.isArray(chatId)) {
            const chats = cleanChatDeleteTargets(chatId);
            if (!chats.length) return true;
            await callFunction('deleteChat', { chats, cleanup: cleanup !== false });
            return true;
        }
        if (!chatId) throw new Error('chat id required');
        await callFunction('deleteChat', { chatId, entryId, linkId, cleanup: cleanup !== false });
        return true;
    }

    async function readChatStatuses(chatIds = []) {
        const ids = [...new Set((Array.isArray(chatIds) ? chatIds : [chatIds]).filter(Boolean))];
        if (!ids.length) return [];
        const snaps = await Promise.all(ids.map((id) => getDocFromServer(doc(db, 'chats', id)).catch(() => null)));
        return snaps.map((snap, index) => ({
            chatId: ids[index],
            active: !(snap?.data?.()?.deleted),
        }));
    }

    async function openChatLink(linkId) {
        if (!linkId) throw new Error('link id required');
        const result = await callFunction('openChatLink', { linkId });
        const chat = result?.chat || {};
        return {
            id: chat.id || '',
            version: Number.isInteger(chat.version) ? chat.version : 0,
            exists: chat.exists === true,
        };
    }

    async function submitReport(payload) {
        await callFunction('submitReport', payload);
        return true;
    }

    async function reserveReportEvidence(payload) {
        await callFunction('reserveReportEvidenceUpload', payload);
        return true;
    }

    async function uploadReportEvidence(reporter, targetUid, evidenceId, data, options = {}) {
        const {
            contentType = 'application/octet-stream',
            cacheControl = 'private, max-age=0, no-transform',
            name = '',
            kind = '',
        } = options || {};
        const path = reportEvidencePath(reporter, targetUid, evidenceId);
        const metadata = {
            contentType,
            cacheControl,
            customMetadata: {
                ...(name ? { name } : {}),
                ...(kind ? { kind } : {}),
            },
        };
        await reserveReportEvidence({
            path,
            size: uploadByteSize(data),
            contentType,
        });
        await uploadStorageFile(path, data, metadata);
        return path;
    }

    const authApi = {
        get user() {
            return resolveAuth()?.currentUser ?? null;
        },
        watch: watchAuth,
        logout,
        logoutDevices,
        login: {
            start: (payload) => callFunction('passkeyLoginOptions', payload),
            finish: (payload) => finishAuth('passkeyLoginVerify', payload),
        },
        register: {
            start: (payload) => callFunction('passkeyRegisterOptions', payload),
            finish: (payload) => finishAuth('passkeyRegisterVerify', payload),
        },
    };

    function userChatsQuery(uid, count, afterChat) {
        const clauses = [collection(db, 'users', uid, 'chats'), orderBy('ts', 'desc'), orderBy(documentId(), 'desc')];
        const marker = pageMarker(afterChat);
        if (marker) {
            clauses.push(startAfter(marker.ts, marker.id));
        }
        clauses.push(limit(positiveInt(count, CHAT_LIST_PAGE_SIZE)));
        return query(...clauses);
    }

    function userChatsPage(snap, count) {
        return {
            records: userChatRecordsFromSnapshot(snap),
            nextAfterChat: pageMarkerFromDoc(snap.docs[snap.docs.length - 1] ?? null),
            hasMore: snap.docs.length >= positiveInt(count, CHAT_LIST_PAGE_SIZE),
        };
    }

    function userChatRecordFromDoc(snap) {
        return decodeBodyRecord(recordFromDoc(snap), 'chat entry body');
    }

    function userChatRecordsFromSnapshot(snapshot) {
        return snapshot.docs
            .map(userChatRecordFromDoc)
            .filter(Boolean);
    }

    function messageRecordFromDoc(snap) {
        if (!snap?.exists?.()) {
            return null;
        }
        const data = snap.data() || {};
        return {
            ...data,
            body: data.body == null ? data.body : readCloudBytes(data.body, 'chat message body'),
            id: snap.id,
            pending: snap.metadata?.hasPendingWrites === true,
        };
    }

    function messageRecordsFromSnapshot(snapshot) {
        return snapshot.docs
            .map(messageRecordFromDoc)
            .filter(Boolean);
    }

    function messageChangesFromSnapshot(snapshot) {
        return snapshot.docChanges().map((change) => ({
            type: change.type,
            record: messageRecordFromDoc(change.doc),
        })).filter((change) => change.record);
    }

    function chatMessagesCollection(chatId) {
        if (!chatId) throw new Error('chat id required');
        return collection(db, 'chats', chatId, 'messages');
    }

    function chatMessageDoc(chatId, messageId) {
        if (!chatId) throw new Error('chat id required');
        if (!messageId) throw new Error('message id required');
        return doc(db, 'chats', chatId, 'messages', messageId);
    }

    function newChatMessageId(chatId) {
        return doc(chatMessagesCollection(chatId)).id;
    }

    function chatMessagesPage(snap, count) {
        const records = messageRecordsFromSnapshot(snap);
        return {
            records,
            nextOlderThan: pageMarkerFromDoc(snap.docs[0] ?? null),
            hasMore: records.length >= positiveInt(count, CHAT_MESSAGE_BATCH_SIZE),
        };
    }

    function chatMessagesQuery(chatId, count, olderThan) {
        const clauses = [chatMessagesCollection(chatId), orderBy('ts', 'asc'), orderBy(documentId(), 'asc')];
        const marker = pageMarker(olderThan);
        if (marker) {
            clauses.push(endBefore(marker.ts, marker.id));
        }
        clauses.push(limitToLast(positiveInt(count, CHAT_MESSAGE_BATCH_SIZE)));
        return query(...clauses);
    }

    function watchChatMessages(chatId, options = {}, onUpdate, onError) {
        const count = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_MESSAGE_BATCH_SIZE);
        return onSnapshot(
            query(chatMessagesCollection(chatId), orderBy('ts', 'asc'), orderBy(documentId(), 'asc'), limitToLast(count)),
            { includeMetadataChanges: true },
            (snap) => {
                const records = messageRecordsFromSnapshot(snap);
                onUpdate?.(records, {
                    changes: messageChangesFromSnapshot(snap),
                    olderThan: pageMarkerFromDoc(snap.docs[0] ?? null),
                    fromCache: snap.metadata?.fromCache === true,
                    pending: snap.metadata?.hasPendingWrites === true,
                });
            },
            onError
        );
    }

    function watchChatMessageWindow(chatId, options = {}, onUpdate, onError) {
        const marker = pageMarker(options?.from);
        if (!marker) {
            return () => {};
        }
        return onSnapshot(
            query(chatMessagesCollection(chatId), orderBy('ts', 'asc'), orderBy(documentId(), 'asc'), startAt(marker.ts, marker.id)),
            { includeMetadataChanges: true },
            (snap) => {
                if (snap.metadata?.fromCache) {
                    return;
                }
                const keys = new Set();
                const cidById = new Map();
                for (const record of messageRecordsFromSnapshot(snap)) {
                    if (record?.id) {
                        cidById.set(record.id, typeof record?.head?.cid === 'string' ? record.head.cid : '');
                    }
                    for (const key of messageRecordKeys(record)) {
                        keys.add(key);
                    }
                }
                const removedKeys = new Set();
                const expiredKeys = new Set();
                const now = Date.now();
                for (const change of snap.docChanges()) {
                    if (change.type !== 'removed') {
                        continue;
                    }
                    const record = messageRecordFromDoc(change.doc);
                    const targetKeys = messageRecordTtlExpired(record, now) ? expiredKeys : removedKeys;
                    for (const key of messageRecordKeys(record)) {
                        targetKeys.add(key);
                    }
                }
                onUpdate?.({ keys, removedKeys, expiredKeys, cidById });
            },
            onError
        );
    }

    async function listChatMessages(chatId, options = {}) {
        const count = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_MESSAGE_BATCH_SIZE);
        const snap = await getDocsFromServer(chatMessagesQuery(chatId, count, options?.olderThan));
        return chatMessagesPage(snap, count);
    }

    async function readChatMessage(chatId, messageId) {
        const snap = await getDocFromServer(chatMessageDoc(chatId, messageId)).catch(() => null);
        return messageRecordFromDoc(snap);
    }

    function cleanMessageWrite(message) {
        if (!message?.head || !message?.body) {
            throw new Error('message data required');
        }
        return {
            head: message.head,
            body: writeCloudBytes(message.body, 'chat message body'),
            ts: serverTimestamp(),
            ttl: Number.isFinite(message?.ttlMs) ? Timestamp.fromMillis(message.ttlMs) : null,
        };
    }

    function cleanOwnerEntryWrite(ownerEntry) {
        if (!ownerEntry?.uid || !ownerEntry?.entryId || !ownerEntry?.record?.body) {
            return null;
        }
        return {
            ref: doc(db, 'users', ownerEntry.uid, 'chats', ownerEntry.entryId),
            data: {
                body: writeCloudBytes(ownerEntry.record.body, 'chat entry body'),
                ts: Number.isFinite(ownerEntry.record.tsMs) ? Timestamp.fromMillis(ownerEntry.record.tsMs) : serverTimestamp(),
            },
        };
    }

    async function pushInbox(recipientUid, ping) {
        requireUid(recipientUid);
        if (!ping) throw new Error('inbox ping required');
        await callFunction('push', {
            recipientUid,
            ping: {
                v: ping.v,
                epk: ping.epk,
                body: cloudBytesBase64(ping.body, 'inbox ping body'),
            },
        });
        return true;
    }

    async function sendChatMessage(payload = {}) {
        const chatId = payload.chatId;
        const messageId = payload.messageId || newChatMessageId(chatId);
        const batch = writeBatch(db);
        batch.set(chatMessageDoc(chatId, messageId), cleanMessageWrite(payload.message));
        const ownerEntry = cleanOwnerEntryWrite(payload.ownerEntry);
        if (ownerEntry) {
            batch.set(ownerEntry.ref, ownerEntry.data, { merge: true });
        }
        await batch.commit();
        if (payload.inbox?.recipientUid && payload.inbox?.ping) {
            await pushInbox(payload.inbox.recipientUid, payload.inbox.ping);
        }
        return { chatId, messageId };
    }

    async function updateChatMessage(chatId, _messageId, message) {
        const messageId = newChatMessageId(chatId);
        await setDoc(chatMessageDoc(chatId, messageId), cleanMessageWrite(message));
        return { chatId, messageId };
    }

    async function deleteChatMessage(chatId, messageId, options = {}) {
        const mediaPaths = Array.isArray(options?.mediaPaths) ? options.mediaPaths : [];
        await deleteDoc(chatMessageDoc(chatId, messageId));
        await Promise.allSettled(mediaPaths.map((path) => deleteChatMedia(chatId, path)));
        return true;
    }

    async function deleteManyChatMessages(chatId, messageIds = [], options = {}) {
        if (!chatId) throw new Error('chat id required');
        const ids = [...new Set((Array.isArray(messageIds) ? messageIds : [messageIds]).filter(Boolean))];
        if (!ids.length) {
            return 0;
        }
        const mediaPaths = Array.isArray(options?.mediaPaths) ? options.mediaPaths : [];
        for (let index = 0; index < ids.length; index += 400) {
            const batch = writeBatch(db);
            ids.slice(index, index + 400).forEach((id) => batch.delete(chatMessageDoc(chatId, id)));
            await batch.commit();
        }
        await Promise.allSettled(mediaPaths.map((path) => deleteChatMedia(chatId, path)));
        return ids.length;
    }

    async function writeChatMessageTtl(chatId, messages = [], options = {}) {
        if (!chatId) throw new Error('chat id required');
        const items = Array.isArray(messages) ? messages.filter((item) => item?.id) : [];
        if (!items.length) {
            return { updated: 0 };
        }

        const mediaPaths = [...new Set(items.map((item) => (item?.mediaPath ? chatMediaDeletePath(chatId, item.mediaPath) : '')).filter(Boolean))];
        const ttlMs = Number(options?.ttlMs);
        if (options?.permanent !== true && !Number.isFinite(ttlMs)) {
            throw new Error('message ttl required');
        }
        const ttl = options?.permanent === true ? null : Timestamp.fromMillis(ttlMs);
        const updateItems = async (nextTtl = ttl, targetItems = items) => {
            const updated = [];
            for (const item of targetItems) {
                await updateDoc(chatMessageDoc(chatId, item.id), { ttl: nextTtl });
                updated.push(item);
            }
            return updated;
        };

        if (options?.permanent === true) {
            const held = [];
            try {
                for (const path of mediaPaths) {
                    await setChatMediaHold(chatId, path, true);
                    held.push(path);
                }
                const updated = await updateItems();
                return { updated: updated.length };
            } catch (error) {
                await Promise.allSettled(held.map((path) => setChatMediaHold(chatId, path, false)));
                throw error;
            }
        }

        let updated = [];
        try {
            updated = await updateItems();
            for (const path of mediaPaths) {
                await setChatMediaHold(chatId, path, false);
            }
            return { updated: updated.length };
        } catch (error) {
            await Promise.allSettled(updated.map((item) => updateDoc(chatMessageDoc(chatId, item.id), { ttl: null })));
            await Promise.allSettled(mediaPaths.map((path) => setChatMediaHold(chatId, path, true)));
            throw error;
        }
    }

    function watchUserChats(uid, onUpdate, onError, options = {}) {
        requireUid(uid);
        const count = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_LIST_PAGE_SIZE);
        return onSnapshot(
            userChatsQuery(uid, count),
            (snap) => {
                if (snap.metadata?.hasPendingWrites) return;
                const page = userChatsPage(snap, count);
                onUpdate?.(page.records, {
                    nextAfterChat: page.nextAfterChat,
                    hasMore: page.hasMore,
                });
            },
            onError
        );
    }

    async function listUserChats(uid, options = {}) {
        requireUid(uid);
        const count = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_LIST_PAGE_SIZE);
        const snap = await getDocsFromServer(userChatsQuery(uid, count, options?.afterChat));
        return userChatsPage(snap, count);
    }

    async function readUserChat(uid, entryId) {
        requireUid(uid);
        if (!entryId) throw new Error('chat entry id required');
        const snap = await getDocFromServer(doc(db, 'users', uid, 'chats', entryId)).catch(() => null);
        return userChatRecordFromDoc(snap);
    }

    async function writeUserChat(uid, entryId, { body, tsMs, touchTs = false } = {}) {
        requireUid(uid);
        if (!entryId) throw new Error('chat entry id required');
        if (!body) throw new Error('chat entry body required');
        const record = { body: writeCloudBytes(body, 'chat entry body') };
        if (Number.isFinite(tsMs)) {
            record.ts = Timestamp.fromMillis(tsMs);
        } else if (touchTs) {
            record.ts = serverTimestamp();
        }
        await setDoc(
            doc(db, 'users', uid, 'chats', entryId),
            record,
            { merge: true }
        );
        return true;
    }

    async function deleteUserChat(uid, entryId) {
        requireUid(uid);
        if (!entryId) throw new Error('chat entry id required');
        await deleteDoc(doc(db, 'users', uid, 'chats', entryId));
        return true;
    }

    function watchInbox(uid, onUpdate, onError, options = {}) {
        requireUid(uid);
        const count = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_INBOX_PING_PAGE_SIZE);
        return onSnapshot(
            query(collection(db, 'users', uid, 'inbox'), orderBy('ts', 'desc'), limit(count)),
            (snap) => {
                onUpdate?.(inboxRecordsFromSnapshot(snap), {
                    empty: snap.empty,
                    pending: snap.metadata?.hasPendingWrites === true,
                });
            },
            onError
        );
    }

    async function listInbox(uid, options = {}) {
        requireUid(uid);
        const count = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, CHAT_INBOX_PING_PAGE_SIZE);
        const snap = await getDocsFromServer(query(collection(db, 'users', uid, 'inbox'), orderBy('ts', 'desc'), limit(count))).catch(() => null);
        return inboxRecordsFromSnapshot(snap || { docs: [] });
    }

    function inboxRecordFromDoc(snap) {
        return decodeBodyRecord(recordFromDoc(snap), 'inbox ping body');
    }

    function inboxRecordsFromSnapshot(snapshot) {
        return snapshot.docs
            .map(inboxRecordFromDoc)
            .filter(Boolean);
    }

    async function deleteInboxItem(uid, pingId) {
        requireUid(uid);
        if (!pingId) throw new Error('inbox id required');
        await deleteDoc(doc(db, 'users', uid, 'inbox', pingId));
        return true;
    }

    function watchAdminBotRuntime(onUpdate, onError) {
        return onSnapshot(
            doc(db, 'runtimes', 'bot'),
            (snap) => {
                onUpdate?.(snap.exists() && snap.data()?.running === true, { exists: snap.exists() });
            },
            onError
        );
    }

    function watchAdminReportOffenders(onUpdate, onError) {
        return onSnapshot(
            collection(db, 'reported'),
            (snap) => {
                onUpdate?.(snap.docs.map((item) => ({ ...item.data(), uid: item.id })));
            },
            onError
        );
    }

    function watchAdminUserReports(uid, onUpdate, onError) {
        requireUid(uid);
        return onSnapshot(
            collection(db, 'reported', uid, 'reports'),
            (snap) => {
                onUpdate?.(recordsFromSnapshot(snap));
            },
            onError
        );
    }

    function watchAdminBots(onUpdate, onError) {
        return onSnapshot(
            collection(db, 'bots'),
            (snap) => {
                onUpdate?.(recordsFromSnapshot(snap));
            },
            onError
        );
    }

    function watchAdminBot(botId, onUpdate, onError) {
        requireUid(botId);
        return onSnapshot(
            doc(db, 'bots', botId),
            (snap) => {
                onUpdate?.(recordFromDoc(snap), { exists: snap.exists() });
            },
            onError
        );
    }

    function watchAdminBotEvents(botId, onUpdate, onError, options = {}) {
        requireUid(botId);
        const count = positiveInt(options?.limitCount ?? options?.pageSize ?? options?.count, 50);
        return onSnapshot(
            query(collection(db, 'bots', botId, 'events'), orderBy('createdAt', 'desc'), limit(count)),
            (snap) => {
                onUpdate?.(recordsFromSnapshot(snap));
            },
            onError
        );
    }

    function watchAdminModeration(uid, onUpdate, onError) {
        requireUid(uid);
        return onSnapshot(
            doc(db, 'moderation', uid),
            (snap) => {
                onUpdate?.(snap.exists() ? (snap.data()?.banned ?? null) : null, { exists: snap.exists() });
            },
            onError
        );
    }

    async function banAdminUser(uid, feature = 'chat') {
        requireUid(uid);
        await setDoc(
            doc(db, 'moderation', uid),
            { banned: { [feature]: { until: null } } },
            { merge: true }
        );
        if (feature === 'avatar') {
            await deleteProfileAvatar(uid).catch((error) => {
                if (error?.code !== 'storage/object-not-found') {
                    throw error;
                }
            });
        }
        return true;
    }

    async function unbanAdminUser(uid, feature = 'chat') {
        requireUid(uid);
        await setDoc(
            doc(db, 'moderation', uid),
            { banned: { [feature]: deleteField() } },
            { merge: true }
        );
        return true;
    }

    async function powerAdminBot(uid, enabled) {
        requireUid(uid);
        await callFunction('setBotPower', { botId: uid, enabled: !!enabled });
        return true;
    }

    async function adminReportEvidencePath(path) {
        if (!path) throw new Error('report evidence path required');
        const targetStorage = resolveStorage();
        if (!targetStorage) throw new Error('createFirebaseCloud requires storage');
        return getDownloadURL(ref(targetStorage, path));
    }

    return {
        user: {
            vault: {
                read: readVault,
                exists: vaultExists,
                write: writeVault,
                replace: replaceVault,
                watch: watchVault,
            },
            onboarding: readOnboarding,
            community: {
                accept: acceptCommunity,
            },
            delete: deleteUser,
            username: {
                get: getUsername,
            },
            profile: {
                watch: watchProfile,
                avatar: {
                    write: writeProfileAvatar,
                    upload: uploadProfileAvatar,
                    delete: deleteProfileAvatar,
                },
                walletpk: {
                    write: writeProfileWalletPK,
                },
                chatpk: {
                    write: writeProfileChatPK,
                },
            },
            private: {
                watch: watchPrivate,
            },
            banned: watchUserBanned,
            settings: {
                read: readSettings,
                write: writeSettings,
            },
            active: {
                write: writeUserActive,
            },
            push: {
                add: addUserPush,
                drop: dropUserPush,
            },
            blocked: {
                add: addBlocked,
                remove: removeBlocked,
                watch: watchBlocked,
            },
            chats: {
                watch: watchUserChats,
                list: listUserChats,
                read: readUserChat,
                write: writeUserChat,
                delete: deleteUserChat,
            },
            admin: {
                is: isAdmin,
                watch: watchAdmin,
            },
        },
        bitcoin: {
            watch: watchBitcoin,
        },
        peer: {
            read: readPeer,
            active: {
                read: readPeerActive,
                watch: watchPeerActive,
            },
            avatar: {
                read: readPeerAvatar,
                url: peerAvatarUrl,
            },
        },
        search: {
            peer: {
                byUsername: (username) => searchPeerByField('username', username),
                byUsernamePrefix: searchPeerByUsernamePrefix,
                byWalletPK: (walletPK, options) => searchPeerByField('walletPK', walletPK, options),
                byWalletPKs: (walletPKs, options) => searchPeerByFields('walletPK', walletPKs, options),
                byChatPK: (chatPK) => searchPeerByField('chatPK', chatPK),
                byChatPKs: (chatPKs) => searchPeerByFields('chatPK', chatPKs),
                byRole: searchPeerByRole,
            },
        },
        chat: {
            check: readChatStatuses,
            delete: deleteChat,
            links: {
                open: openChatLink,
            },
            messages: {
                id: newChatMessageId,
                watch: watchChatMessages,
                watchWindow: watchChatMessageWindow,
                list: listChatMessages,
                read: readChatMessage,
                send: sendChatMessage,
                update: updateChatMessage,
                delete: deleteChatMessage,
                deleteMany: deleteManyChatMessages,
                ttl: writeChatMessageTtl,
            },
            media: {
                upload: uploadChatMedia,
                uploadShared: uploadSharedMedia,
                read: readChatMedia,
            },
        },
        inbox: {
            watch: watchInbox,
            list: listInbox,
            delete: deleteInboxItem,
            push: pushInbox,
        },
        admin: {
            reports: {
                watchOffenders: watchAdminReportOffenders,
                watchUser: watchAdminUserReports,
                evidence: {
                    path: adminReportEvidencePath,
                },
            },
            bots: {
                watch: watchAdminBots,
                watchBot: watchAdminBot,
                watchEvents: watchAdminBotEvents,
                watchRuntime: watchAdminBotRuntime,
                power: powerAdminBot,
            },
            moderation: {
                watch: watchAdminModeration,
                ban: banAdminUser,
                unban: unbanAdminUser,
            },
        },
        reports: {
            submit: submitReport,
            evidence: {
                reserve: reserveReportEvidence,
                upload: uploadReportEvidence,
            },
        },
        auth: authApi,
    };
}
