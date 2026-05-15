import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { avatarPath, getFileUrl } from './files.js';
import { normalizeWalletNetwork, resolveWalletPK, walletPKField } from './walletkeys.js';

export function createPeersApi({ db, storage, getStorage, network }) {
    if (!db) {
        throw new Error('createPeersApi requires db');
    }

    function resolveStorage() {
        return typeof getStorage === 'function' ? getStorage() : storage;
    }

    const walletNetwork = normalizeWalletNetwork(network);
    const avatarCache = new Map();
    const refreshedAvatars = new Set();
    const profileCache = new Map();
    const walletToUid = new Map();
    const chatToUid = new Map();

    function readBotMarker(data) {
        const bot = data?.bot;
        if (!bot) return null;
        return typeof bot === 'string' ? bot : 'bot';
    }

    function createProfileFromDoc(docSnap) {
        const data = docSnap.data();
        const uid = docSnap.id;
        return {
            username: data?.username || null,
            avatar: null,
            walletPK: resolveWalletPK(data, walletNetwork),
            chatPK: data?.chatPK || null,
            active: data?.active ?? false,
            bot: readBotMarker(data),
            uid,
        };
    }

    function cacheBustUrl(url) {
        if (!url) return null;
        return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now().toString(36)}`;
    }

    async function getAvatarUrl(uid, options = {}) {
        if (!uid) return null;
        const force = options?.force === true;
        if (force) {
            avatarCache.delete(uid);
        }
        if (!avatarCache.has(uid)) {
            const storage = resolveStorage();
            if (!storage) return null;
            avatarCache.set(
                uid,
                getFileUrl(storage, avatarPath(uid))
                    .then((url) => (force ? cacheBustUrl(url) : url))
                    .catch(() => null)
            );
        }
        return avatarCache.get(uid);
    }

    function shouldRefreshAvatar(uid, options = {}) {
        return !!(uid && options?.refreshAvatar && !refreshedAvatars.has(uid));
    }

    function hasPeerKeys(profile) {
        return !!(profile?.walletPK || profile?.chatPK);
    }

    function cachePeer(profile) {
        if (!profile?.uid || !hasPeerKeys(profile)) return null;
        const existing = profileCache.get(profile.uid);
        const nextProfile = existing
            ? {
                  ...existing,
                  ...profile,
                  avatar: profile.avatar ?? existing.avatar ?? null,
              }
            : profile;

        profileCache.set(profile.uid, nextProfile);
        if (nextProfile.walletPK) walletToUid.set(nextProfile.walletPK, nextProfile.uid);
        if (nextProfile.chatPK) chatToUid.set(nextProfile.chatPK, nextProfile.uid);
        return nextProfile;
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

        const refreshAvatar = shouldRefreshAvatar(profile.uid, options);
        if (refreshAvatar || !profile.avatar) {
            const avatarUrl = await getAvatarUrl(profile.uid, { force: refreshAvatar });
            if (refreshAvatar) {
                refreshedAvatars.add(profile.uid);
                profile.avatar = avatarUrl || null;
            } else if (avatarUrl) {
                profile.avatar = avatarUrl;
            }
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

            const data = docSnap.data();
            const nextProfile = {
                username: data?.username || null,
                avatar: null,
                walletPK: resolveWalletPK(data, walletNetwork),
                chatPK: data?.chatPK || null,
                active: data?.active ?? false,
                bot: readBotMarker(data),
                uid,
            };
            const existing = profileCache.get(uid);
            const refreshAvatar = shouldRefreshAvatar(uid, options);
            const refreshedAvatar = refreshAvatar ? await getAvatarUrl(uid, { force: true }) : null;
            if (refreshAvatar) {
                refreshedAvatars.add(uid);
            }

            if (existing) {
                const changed =
                    existing.username !== nextProfile.username ||
                    existing.walletPK !== nextProfile.walletPK ||
                    existing.chatPK !== nextProfile.chatPK ||
                    existing.active !== nextProfile.active ||
                    existing.bot !== nextProfile.bot;
                const nextAvatar = refreshAvatar ? refreshedAvatar || null : existing.avatar ?? nextProfile.avatar ?? null;

                if (!changed && nextAvatar === (existing.avatar ?? null)) {
                    return null;
                }

                const merged = {
                    ...existing,
                    ...nextProfile,
                    avatar: nextAvatar,
                };
                profileCache.set(uid, merged);
                if (merged.walletPK) walletToUid.set(merged.walletPK, merged.uid);
                if (merged.chatPK) chatToUid.set(merged.chatPK, merged.uid);
                return { uid, active: merged.active };
            } else {
                const profile = cachePeer(nextProfile);
                if (!profile) return null;
                if (refreshAvatar) {
                    profile.avatar = refreshedAvatar || null;
                    profileCache.set(uid, profile);
                }
                return { uid, active: profile.active };
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
