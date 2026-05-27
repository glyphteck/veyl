import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { avatarPath, getFileUrl } from './files.js';
import { normalizeWalletNetwork, resolveWalletPK, walletPKField } from './wallet/keys.js';

export function createPeersApi({ db, storage, getStorage, network }) {
    if (!db) {
        throw new Error('createPeersApi requires db');
    }

    function resolveStorage() {
        return typeof getStorage === 'function' ? getStorage() : storage;
    }

    const walletNetwork = normalizeWalletNetwork(network);
    const avatarCache = new Map();
    const profileCache = new Map();
    const walletToUid = new Map();
    const chatToUid = new Map();

    function readBotMarker(data) {
        const bot = data?.bot;
        if (!bot) return null;
        return typeof bot === 'string' ? bot : 'bot';
    }

    function readAvatarVersion(value) {
        if (value == null || value === '' || (typeof value !== 'number' && typeof value !== 'string')) {
            return null;
        }
        const version = Number(value);
        return Number.isSafeInteger(version) && version >= 0 ? version : null;
    }

    function createProfileFromData(uid, data) {
        return {
            username: data?.username || null,
            avatar: null,
            walletPK: resolveWalletPK(data, walletNetwork),
            chatPK: data?.chatPK || null,
            active: data?.active ?? false,
            bot: readBotMarker(data),
            avatarVersion: readAvatarVersion(data?.avatar),
            uid,
        };
    }

    function createProfileFromDoc(docSnap) {
        return createProfileFromData(docSnap.id, docSnap.data());
    }

    function avatarUrlWithVersion(url, version) {
        if (!url) return null;
        return version == null ? url : `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(version))}`;
    }

    async function getAvatarUrl(uid, options = {}) {
        if (!uid) return null;
        const version = readAvatarVersion(options?.version);
        const key = version == null ? 'unknown' : String(version);
        const force = options?.force === true;
        const cached = avatarCache.get(uid);
        if (!force && cached?.key === key) {
            return cached.promise;
        }

        const storage = resolveStorage();
        if (!storage) return null;
        const promise = getFileUrl(storage, avatarPath(uid))
            .then((url) => avatarUrlWithVersion(url, version))
            .catch(() => null);
        avatarCache.set(uid, { key, promise });
        return promise;
    }

    function clearAvatarUrl(uid) {
        if (uid) avatarCache.delete(uid);
    }

    function hasPeerKeys(profile) {
        return !!(profile?.walletPK || profile?.chatPK);
    }

    function avatarStateChanged(existing, profile) {
        if (!existing || !profile) return false;
        if (profile.avatarVersion == null) {
            return existing.avatarVersion != null || !!existing.avatar;
        }
        return profile.avatarVersion !== (existing.avatarVersion ?? null);
    }

    function mergeCachedProfile(existing, profile) {
        const changedAvatarState = avatarStateChanged(existing, profile);
        const avatar = profile.avatarVersion == null ? null : profile.avatar ?? (!changedAvatarState ? existing?.avatar ?? null : null);
        return existing
            ? {
                  ...existing,
                  ...profile,
                  avatar,
              }
            : {
                  ...profile,
                  avatar: avatar ?? null,
              };
    }

    function profileChanged(existing, profile) {
        return (
            existing.username !== profile.username ||
            existing.walletPK !== profile.walletPK ||
            existing.chatPK !== profile.chatPK ||
            existing.active !== profile.active ||
            existing.bot !== profile.bot ||
            existing.avatarVersion !== profile.avatarVersion ||
            (existing.avatar ?? null) !== (profile.avatar ?? null)
        );
    }

    function storeProfile(profile) {
        profileCache.set(profile.uid, profile);
        if (profile.walletPK) walletToUid.set(profile.walletPK, profile.uid);
        if (profile.chatPK) chatToUid.set(profile.chatPK, profile.uid);
        return profile;
    }

    function cachePeer(profile) {
        if (!profile?.uid || !hasPeerKeys(profile)) return null;
        const existing = profileCache.get(profile.uid);
        return storeProfile(mergeCachedProfile(existing, profile));
    }

    async function resolveProfileAvatar(profile, existing, options = {}) {
        if (!profile?.uid) return null;
        if (profile.avatarVersion == null) {
            clearAvatarUrl(profile.uid);
            return null;
        }

        const changedAvatarState = avatarStateChanged(existing, profile);
        const currentAvatar = changedAvatarState ? null : profile.avatar ?? existing?.avatar ?? null;
        if (currentAvatar && (options?.refreshAvatar !== true || profile.avatarVersion != null)) {
            return currentAvatar;
        }

        const avatarUrl = await getAvatarUrl(profile.uid, {
            version: profile.avatarVersion,
        });
        return avatarUrl || null;
    }

    function hydrateProfiles(profiles) {
        let count = 0;
        for (const profile of profiles || []) {
            if (cachePeer(profile)) {
                count += 1;
            }
        }
        return count;
    }

    function getCachedProfiles() {
        return Array.from(profileCache.values());
    }

    function getProfileFromPK(pk, type) {
        if (!pk) return null;
        const uid = (type === 'wallet' ? walletToUid : chatToUid).get(pk);
        return uid ? profileCache.get(uid) : null;
    }

    async function buildPeer(profile, stats, options = {}) {
        if (!profile?.uid || !hasPeerKeys(profile)) return null;

        const avatar = await resolveProfileAvatar(profile, profileCache.get(profile.uid), options);
        if ((profile.avatar ?? null) !== avatar) {
            profile.avatar = avatar;
            storeProfile(profile);
        }

        const peer = { ...profile };
        if (stats) peer.stats = stats;
        return peer;
    }

    async function addPeerToCache(profile, stats) {
        if (!profile?.uid || !hasPeerKeys(profile)) return null;
        const cachedProfile = cachePeer(profile);
        if (!cachedProfile) return null;
        return await buildPeer(cachedProfile, stats);
    }

    async function fetchProfileByUid(uid) {
        if (!uid) return null;
        if (profileCache.has(uid)) return profileCache.get(uid);

        try {
            const docRef = doc(db, 'profiles', uid);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) return null;

            const nextProfile = createProfileFromDoc(docSnap);
            if (!hasPeerKeys(nextProfile)) return null;
            const profile = cachePeer(nextProfile);
            return profile;
        } catch {
            return null;
        }
    }

    async function updatePeerByUID(uid, options = {}) {
        if (!uid) return null;

        try {
            const docRef = doc(db, 'profiles', uid);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) return null;

            const nextProfile = createProfileFromDoc(docSnap);
            const existing = profileCache.get(uid);
            const nextAvatar = await resolveProfileAvatar(nextProfile, existing, options);
            const merged = mergeCachedProfile(existing, { ...nextProfile, avatar: nextAvatar });

            if (existing) {
                if (!profileChanged(existing, merged)) {
                    return null;
                }

                storeProfile(merged);
                return { uid, active: merged.active };
            } else {
                if (!hasPeerKeys(merged)) return null;
                storeProfile(merged);
                return { uid, active: merged.active };
            }
        } catch {
            return null;
        }
    }

    async function fetchProfileByField(field, value) {
        if (!field || !value) return null;

        if (field === 'walletPK' && walletToUid.has(value)) {
            const uid = walletToUid.get(value);
            return profileCache.get(uid) ?? null;
        }
        if (field === 'chatPK' && chatToUid.has(value)) {
            const uid = chatToUid.get(value);
            return profileCache.get(uid) ?? null;
        }

        try {
            const queryField = field === 'walletPK' ? walletPKField(walletNetwork) : field;
            const snapshot = await getDocs(query(collection(db, 'profiles'), where(queryField, '==', value), limit(1)));
            if (snapshot.empty) return null;

            const nextProfile = createProfileFromDoc(snapshot.docs[0]);
            if (!hasPeerKeys(nextProfile)) return null;
            const profile = cachePeer(nextProfile);
            return profile;
        } catch {
            return null;
        }
    }

    function isFullProfile(profile) {
        return !!(profile?.uid && ('active' in profile || 'username' in profile || ('walletPK' in profile && 'chatPK' in profile)));
    }

    async function fetchAndCachePeer(partialProfile, stats) {
        if (!partialProfile) return null;

        let fullProfile = null;
        if (isFullProfile(partialProfile)) {
            fullProfile = {
                username: partialProfile.username || null,
                avatar: partialProfile.avatar || null,
                walletPK: partialProfile.walletPK || null,
                chatPK: partialProfile.chatPK || null,
                active: partialProfile.active ?? false,
                bot: partialProfile.bot || null,
                avatarVersion: readAvatarVersion(partialProfile.avatarVersion),
                uid: partialProfile.uid,
            };
        } else if (partialProfile.uid) {
            fullProfile = await fetchProfileByUid(partialProfile.uid);
        } else if (partialProfile.walletPK) {
            fullProfile = await fetchProfileByField('walletPK', partialProfile.walletPK);
        } else if (partialProfile.chatPK) {
            fullProfile = await fetchProfileByField('chatPK', partialProfile.chatPK);
        } else if (partialProfile.username) {
            fullProfile = await fetchProfileByField('username', partialProfile.username);
        }

        if (!fullProfile) {
            if (partialProfile.walletPK || partialProfile.chatPK || partialProfile.username) {
                fullProfile = {
                    username: partialProfile.username || null,
                    avatar: partialProfile.avatar || null,
                    walletPK: partialProfile.walletPK || null,
                    chatPK: partialProfile.chatPK || null,
                    active: partialProfile.active ?? false,
                    bot: partialProfile.bot || null,
                    avatarVersion: readAvatarVersion(partialProfile.avatarVersion),
                    uid: partialProfile.uid || null,
                };
            } else {
                return null;
            }
        } else {
            fullProfile = {
                ...fullProfile,
                ...partialProfile,
                uid: fullProfile.uid,
            };
        }

        if (!fullProfile.uid || !hasPeerKeys(fullProfile)) return null;
        const cachedProfile = cachePeer(fullProfile);
        if (!cachedProfile) return null;
        return await buildPeer(cachedProfile, stats);
    }

    async function findPeerByWalletPK(walletPK) {
        return await fetchAndCachePeer({ walletPK });
    }

    async function findPeerByChatPK(chatPK) {
        return await fetchAndCachePeer({ chatPK });
    }

    async function findPeerByUsername(username) {
        return await fetchAndCachePeer({ username });
    }

    async function findPeerByUid(uid) {
        return await fetchAndCachePeer({ uid });
    }

    function fetchByField(field, keys) {
        if (!keys?.length) return [];
        const chunks = [];
        for (let i = 0; i < keys.length; i += 10) {
            chunks.push(keys.slice(i, i + 10));
        }
        const queryField = field === 'walletPK' ? walletPKField(walletNetwork) : field;
        return chunks.map((chunk) => getDocs(query(collection(db, 'profiles'), where(queryField, 'in', chunk), limit(chunk.length))));
    }

    async function loadProfiles(walletPKs, chatPKs) {
        const uncachedWalletPKs = (walletPKs || []).filter((key) => key && !walletToUid.has(key));
        const uncachedChatPKs = (chatPKs || []).filter((key) => key && !chatToUid.has(key));

        if (uncachedWalletPKs.length === 0 && uncachedChatPKs.length === 0) return;

        const queryJobs = [...fetchByField('walletPK', uncachedWalletPKs), ...fetchByField('chatPK', uncachedChatPKs)];
        const snapshots = await Promise.all(queryJobs);
        const uniqueProfiles = new Map();

        for (const snapshot of snapshots) {
            for (const docSnap of snapshot.docs) {
                const nextProfile = createProfileFromDoc(docSnap);
                if (!hasPeerKeys(nextProfile)) continue;
                const profile = cachePeer(nextProfile);
                if (!profile) continue;
                uniqueProfiles.set(profile.uid, profile);
            }
        }

        await Promise.all(Array.from(uniqueProfiles.values()).map(async (profile) => buildPeer(profile)));
    }

    function assemblePeers(walletPeers, chatPeers, extraUids = []) {
        const peerMap = new Map();

        for (const [walletKey, peerData] of Object.entries(walletPeers || {})) {
            const profile = getProfileFromPK(walletKey, 'wallet');
            if (profile) {
                let peer = peerMap.get(profile.uid);
                if (!peer) {
                    peer = { ...profile };
                    peerMap.set(profile.uid, peer);
                }
                if (peerData?.stats) {
                    peer.stats = { ...peer.stats, ...peerData.stats };
                }
            }
        }

        for (const chatKey of chatPeers || []) {
            const profile = getProfileFromPK(chatKey, 'chat');
            if (profile && !peerMap.has(profile.uid)) {
                peerMap.set(profile.uid, { ...profile });
            }
        }

        for (const uid of extraUids || []) {
            const profile = profileCache.get(uid);
            if (profile && !peerMap.has(profile.uid)) {
                peerMap.set(profile.uid, { ...profile });
            }
        }

        return Array.from(peerMap.values());
    }

    return {
        createProfileFromDoc,
        buildPeer,
        cachePeer,
        hydrateProfiles,
        getCachedProfiles,
        addPeerToCache,
        fetchProfileByUid,
        updatePeerByUID,
        fetchProfileByField,
        fetchAndCachePeer,
        findPeerByWalletPK,
        findPeerByChatPK,
        findPeerByUsername,
        findPeerByUid,
        loadProfiles,
        assemblePeers,
    };
}
