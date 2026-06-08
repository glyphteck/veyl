import { uniqueValues } from './utils/array.js';
import { readAvatarVersion } from './avatar.js';
import { hasPeerKeys, isFullProfile, normalizeProfile } from './profile.js';
import { normalizeWalletNetwork, resolveWalletPK } from './wallet/keys.js';

export function createPeersApi({ cloud, network, avatarCache = null }) {
    if (!cloud) {
        throw new Error('createPeersApi requires cloud');
    }

    const walletNetwork = normalizeWalletNetwork(network);
    const avatarUrlCache = new Map();
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

    function isLocalAvatarSource(value) {
        return /^(file|blob):/i.test(String(value || ''));
    }

    async function readCachedAvatar(uid, expectedVersion) {
        if (!uid || expectedVersion == null || typeof avatarCache?.read !== 'function') return null;
        try {
            const cached = await avatarCache.read(uid);
            const version = readAvatarVersion(cached?.version);
            const url = typeof cached?.url === 'string' && cached.url ? cached.url : typeof cached?.source === 'string' && cached.source ? cached.source : null;
            return version === expectedVersion && url ? url : null;
        } catch {
            return null;
        }
    }

    async function writeCachedAvatar(uid, version, bytes) {
        if (!uid || version == null || !bytes || typeof avatarCache?.write !== 'function') return null;
        try {
            const cached = await avatarCache.write(uid, { version, bytes });
            return typeof cached === 'string' && cached ? cached : typeof cached?.url === 'string' && cached.url ? cached.url : typeof cached?.source === 'string' && cached.source ? cached.source : null;
        } catch {
            return null;
        }
    }

    async function readAvatarSource(uid, version) {
        const avatarVersion = readAvatarVersion(version);
        const cachedAvatar = await readCachedAvatar(uid, avatarVersion);
        if (cachedAvatar) {
            return cachedAvatar;
        }

        if (avatarVersion != null && typeof cloud.peer.avatar.read === 'function') {
            try {
                const bytes = await cloud.peer.avatar.read(uid);
                const cachedSource = await writeCachedAvatar(uid, avatarVersion, bytes);
                if (cachedSource) {
                    return cachedSource;
                }
            } catch {}
        }

        return await cloud.peer.avatar.url(uid, { version: avatarVersion });
    }

    async function getAvatarUrl(uid, version) {
        if (!uid) return null;
        const key = version == null ? 'unknown' : String(version);
        const cached = avatarUrlCache.get(uid);
        if (cached?.key === key) {
            return cached.promise;
        }

        const promise = readAvatarSource(uid, version).catch(() => null);
        avatarUrlCache.set(uid, { key, promise });
        return promise;
    }

    function clearAvatarUrl(uid) {
        if (uid) avatarUrlCache.delete(uid);
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
        const currentAvatar = profile.avatar ?? existing?.avatar ?? null;
        let reusableAvatar = changedAvatarState ? null : currentAvatar;
        if (!changedAvatarState && currentAvatar) {
            if (typeof avatarCache?.read === 'function') {
                const cachedAvatar = await readCachedAvatar(profile.uid, profile.avatarVersion);
                if (cachedAvatar) {
                    return cachedAvatar;
                }
                if (isLocalAvatarSource(currentAvatar)) {
                    reusableAvatar = null;
                } else if (typeof avatarCache?.write === 'function' && typeof cloud.peer.avatar.read === 'function') {
                    const cachedSource = await getAvatarUrl(profile.uid, profile.avatarVersion);
                    return cachedSource || currentAvatar;
                } else {
                    return currentAvatar;
                }
            } else {
                return currentAvatar;
            }
        }

        const avatarUrl = await getAvatarUrl(profile.uid, profile.avatarVersion);
        return avatarUrl || reusableAvatar || null;
    }

    function hydrateProfiles(profiles) {
        let count = 0;
        for (const profile of profiles || []) {
            if (!profile?.uid || !hasPeerKeys(profile)) {
                continue;
            }

            const existing = profileCache.get(profile.uid);
            const hydrated = existing
                ? {
                      ...profile,
                      ...existing,
                      walletPK: existing.walletPK || profile.walletPK || null,
                      chatPK: existing.chatPK || profile.chatPK || null,
                      username: existing.username || profile.username || null,
                      avatarVersion: existing.avatarVersion ?? profile.avatarVersion ?? null,
                      avatar: existing.avatar || profile.avatar || null,
                      active: existing.active ?? profile.active ?? false,
                      bot: existing.bot || profile.bot || null,
                  }
                : {
                      username: profile.username || null,
                      avatar: profile.avatar || null,
                      walletPK: profile.walletPK || null,
                      chatPK: profile.chatPK || null,
                      active: profile.active ?? false,
                      bot: profile.bot || null,
                      avatarVersion: readAvatarVersion(profile.avatarVersion),
                      uid: profile.uid,
                  };

            storeProfile(hydrated);
            count += 1;
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

    async function buildPeer(profile, stats, existing = profileCache.get(profile?.uid)) {
        if (!profile?.uid || !hasPeerKeys(profile)) return null;

        const avatar = await resolveProfileAvatar(profile, existing);
        const resolvedProfile = (profile.avatar ?? null) === avatar ? profile : storeProfile({ ...profile, avatar });

        const peer = { ...resolvedProfile };
        if (stats) peer.stats = stats;
        return peer;
    }

    async function addPeerToCache(profile, stats) {
        if (!profile?.uid || !hasPeerKeys(profile)) return null;
        const existing = profileCache.get(profile.uid);
        const cachedProfile = cachePeer(profile);
        if (!cachedProfile) return null;
        return await buildPeer(cachedProfile, stats, existing);
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
        const existing = profileCache.get(fullProfile.uid);
        const cachedProfile = cachePeer(fullProfile);
        if (!cachedProfile) return null;
        return await buildPeer(cachedProfile, stats, existing);
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

    function needsAvatarResolve(profile) {
        return (
            !!profile?.uid &&
            profile.avatarVersion != null &&
            (!profile.avatar || (typeof avatarCache?.read === 'function' && !isLocalAvatarSource(profile.avatar)))
        );
    }

    function queueCachedAvatarResolve(profiles, key, type) {
        const profile = getProfileFromPK(key, type);
        if (!needsAvatarResolve(profile) || profiles.has(profile.uid)) {
            return;
        }
        profiles.set(profile.uid, { existing: profile, profile });
    }

    async function loadProfiles(walletPKs, chatPKs) {
        const walletKeys = uniqueLookupKeys(walletPKs);
        const chatKeys = uniqueLookupKeys(chatPKs);
        const uncachedWalletPKs = walletKeys.filter((key) => !walletToUid.has(key));
        const uncachedChatPKs = chatKeys.filter((key) => !chatToUid.has(key));
        const uniqueProfiles = new Map();

        for (const key of walletKeys) {
            queueCachedAvatarResolve(uniqueProfiles, key, 'wallet');
        }
        for (const key of chatKeys) {
            queueCachedAvatarResolve(uniqueProfiles, key, 'chat');
        }

        if (uncachedWalletPKs.length === 0 && uncachedChatPKs.length === 0 && uniqueProfiles.size === 0) return;

        const [walletRecords, chatRecords] =
            uncachedWalletPKs.length || uncachedChatPKs.length
                ? await Promise.all([cloud.search.peer.byWalletPKs(uncachedWalletPKs, { network: walletNetwork }), cloud.search.peer.byChatPKs(uncachedChatPKs)])
                : [[], []];

        for (const record of [...walletRecords, ...chatRecords]) {
            const nextProfile = createProfileFromRecord(record);
            if (!hasPeerKeys(nextProfile)) continue;
            const existing = profileCache.get(nextProfile.uid);
            const profile = cachePeer(nextProfile);
            if (!profile) continue;
            uniqueProfiles.set(profile.uid, { existing, profile });
        }

        await Promise.all(Array.from(uniqueProfiles.values()).map(async ({ existing, profile }) => buildPeer(profile, null, existing)));
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
