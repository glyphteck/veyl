import { uniqueValues } from './utils/array.js';
import { readAvatarVersion } from './avatar.js';
import { hasPeerKeys, isFullProfile, normalizeProfile } from './profile.js';
import { normalizeWalletNetwork, resolveWalletPK } from './wallet/keys.js';

export function createPeersApi({ cloud, network }) {
    if (!cloud) {
        throw new Error('createPeersApi requires cloud');
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

    function createProfileFromRecord(record) {
        return createProfileFromData(record?.uid, record);
    }

    async function getAvatarUrl(uid, version) {
        if (!uid) return null;
        const key = version == null ? 'unknown' : String(version);
        const cached = avatarCache.get(uid);
        if (cached?.key === key) {
            return cached.promise;
        }

        const promise = cloud.peer.avatar.url(uid, { version }).catch(() => null);
        avatarCache.set(uid, { key, promise });
        return promise;
    }

    function clearAvatarUrl(uid) {
        if (uid) avatarCache.delete(uid);
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

    async function resolveProfileAvatar(profile, existing) {
        if (!profile?.uid) return null;
        if (profile.avatarVersion == null) {
            clearAvatarUrl(profile.uid);
            return null;
        }

        const changedAvatarState = avatarStateChanged(existing, profile);
        const currentAvatar = changedAvatarState ? null : profile.avatar ?? existing?.avatar ?? null;
        if (currentAvatar) {
            return currentAvatar;
        }

        const avatarUrl = await getAvatarUrl(profile.uid, profile.avatarVersion);
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

    async function buildPeer(profile, stats) {
        if (!profile?.uid || !hasPeerKeys(profile)) return null;

        const avatar = await resolveProfileAvatar(profile, profileCache.get(profile.uid));
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
            const record = await cloud.peer.read(uid);
            if (!record) return null;

            const nextProfile = createProfileFromRecord(record);
            if (!hasPeerKeys(nextProfile)) return null;
            const profile = cachePeer(nextProfile);
            return profile;
        } catch {
            return null;
        }
    }

    async function updatePeerByUID(uid) {
        if (!uid) return null;

        try {
            const record = await cloud.peer.read(uid);
            if (!record) return null;

            const nextProfile = createProfileFromRecord(record);
            const existing = profileCache.get(uid);
            const nextAvatar = await resolveProfileAvatar(nextProfile, existing);
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
            const record = field === 'walletPK'
                ? await cloud.search.peer.byWalletPK(value, { network: walletNetwork })
                : field === 'chatPK'
                    ? await cloud.search.peer.byChatPK(value)
                    : await cloud.search.peer.byUsername(value);
            if (!record) return null;

            const nextProfile = createProfileFromRecord(record);
            if (!hasPeerKeys(nextProfile)) return null;
            const profile = cachePeer(nextProfile);
            return profile;
        } catch {
            return null;
        }
    }

    async function fetchAndCachePeer(partialProfile, stats) {
        if (!partialProfile) return null;

        let fullProfile = null;
        if (isFullProfile(partialProfile)) {
            fullProfile = normalizeProfile(partialProfile, partialProfile.uid);
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
                fullProfile = normalizeProfile(partialProfile);
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

    function uniqueLookupKeys(keys) {
        return uniqueValues(keys);
    }

    async function loadProfiles(walletPKs, chatPKs) {
        const uncachedWalletPKs = uniqueLookupKeys(walletPKs).filter((key) => !walletToUid.has(key));
        const uncachedChatPKs = uniqueLookupKeys(chatPKs).filter((key) => !chatToUid.has(key));

        if (uncachedWalletPKs.length === 0 && uncachedChatPKs.length === 0) return;

        const [walletRecords, chatRecords] = await Promise.all([
            cloud.search.peer.byWalletPKs(uncachedWalletPKs, { network: walletNetwork }),
            cloud.search.peer.byChatPKs(uncachedChatPKs),
        ]);
        const uniqueProfiles = new Map();

        for (const record of [...walletRecords, ...chatRecords]) {
            const nextProfile = createProfileFromRecord(record);
            if (!hasPeerKeys(nextProfile)) continue;
            const profile = cachePeer(nextProfile);
            if (!profile) continue;
            uniqueProfiles.set(profile.uid, profile);
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
        createProfileFromRecord,
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
