'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { avatarPath, getFileUrl, readFile } from '../files.js';
import { COMMUNITY_RULES_DATE, COMMUNITY_RULES_VERSION } from '../community.js';
import { defaultSettings, writeUserSettings } from '../settings.js';
import { resolveWalletPK } from '../wallet/keys.js';

export const defaultUser = {
    uid: null,
    authReady: false,
    profileReady: false,
    username: null,
    avatar: null,
    avatarVersion: null,
    hasAvatarEntry: false,
    isAdmin: false,
    adminReady: false,
    walletPKs: null,
    walletPK: null,
    chatPK: null,
    active: false,
    banned: null,
    avatarBanned: false,
    communityRulesVersion: null,
    communityRulesDate: null,
    communityRulesAcceptedAt: null,
    communityRulesPending: false,
    blockedReady: false,
    blocked: [],
    settingsReady: false,
    settings: {
        ...defaultSettings,
        autolock: {
            ...defaultSettings.autolock,
        },
    },
};

function getBanUntilMs(ban) {
    if (!ban || typeof ban !== 'object' || Array.isArray(ban)) {
        return null;
    }

    if (ban.until == null) {
        return null;
    }

    if (typeof ban.until?.toMillis === 'function') {
        return ban.until.toMillis();
    }

    if (ban.until instanceof Date) {
        return ban.until.getTime();
    }

    const ms = Number(ban.until);
    return Number.isFinite(ms) ? ms : null;
}

function getActiveBan(ban) {
    if (!ban || typeof ban !== 'object' || Array.isArray(ban)) {
        return null;
    }

    const untilMs = getBanUntilMs(ban);
    if (untilMs == null) {
        return ban;
    }

    return untilMs > Date.now() ? ban : null;
}

function readAvatarVersion(value) {
    if (value == null || value === '' || (typeof value !== 'number' && typeof value !== 'string')) {
        return null;
    }
    const version = Number(value);
    return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function avatarUrlWithVersion(url, version) {
    if (!url) return null;
    return version == null ? url : `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(version))}`;
}

function markDiag(diag, label, data) {
    try {
        diag?.(label, data);
    } catch {}
}

function markDone(diag, label, startedAt, data = {}) {
    markDiag(diag, `${label}.done`, { ...data, elapsedMs: Date.now() - startedAt });
}

function markError(diag, label, startedAt, error, data = {}) {
    markDiag(diag, `${label}.error`, { ...data, elapsedMs: Date.now() - startedAt, code: error?.code || '', message: error?.message || String(error) });
}

export function createUserProvider({ auth, db, storage, getStorage, network, avatarCache = null, diag = null }) {
    if (!auth || !db) {
        throw new Error('createUserProvider requires { auth, db }');
    }

    function resolveStorage() {
        return typeof getStorage === 'function' ? getStorage() : storage;
    }

    async function readCachedAvatar(uid, expectedVersion = null) {
        if (!uid || typeof avatarCache?.read !== 'function') return null;
        try {
            const cached = await avatarCache.read(uid);
            const version = readAvatarVersion(cached?.version);
            if (expectedVersion != null && version !== expectedVersion) {
                return null;
            }
            const url = typeof cached?.url === 'string' && cached.url ? cached.url : typeof cached?.source === 'string' && cached.source ? cached.source : null;
            return version == null || !url ? null : { version, url };
        } catch (error) {
            console.warn('failed to read cached avatar', error);
            return null;
        }
    }

    async function writeCachedAvatar(uid, avatar) {
        if (!uid || typeof avatarCache?.write !== 'function') return;
        const version = readAvatarVersion(avatar?.version);
        const bytes = avatar?.bytes;
        if (version == null || !bytes) return null;
        try {
            const result = await avatarCache.write(uid, { version, bytes });
            return typeof result === 'string' && result ? result : typeof result?.url === 'string' && result.url ? result.url : typeof result?.source === 'string' && result.source ? result.source : null;
        } catch (error) {
            console.warn('failed to cache avatar', error);
            return null;
        }
    }

    function removeCachedAvatar(uid) {
        if (!uid || typeof avatarCache?.remove !== 'function') return;
        try {
            const result = avatarCache.remove(uid);
            result?.catch?.((error) => console.warn('failed to remove cached avatar', error));
        } catch (error) {
            console.warn('failed to remove cached avatar', error);
        }
    }

    function keepOnlyCachedAvatar(uid, previousUid = null) {
        if (!uid) {
            if (typeof avatarCache?.removeAll === 'function') {
                try {
                    const result = avatarCache.removeAll();
                    result?.catch?.((error) => console.warn('failed to clear cached avatars', error));
                } catch (error) {
                    console.warn('failed to clear cached avatars', error);
                }
                return;
            }
            removeCachedAvatar(previousUid);
            return;
        }

        if (typeof avatarCache?.removeAllExcept === 'function') {
            try {
                const result = avatarCache.removeAllExcept(uid);
                result?.catch?.((error) => console.warn('failed to prune cached avatars', error));
            } catch (error) {
                console.warn('failed to prune cached avatars', error);
            }
            return;
        }

        if (previousUid && previousUid !== uid) {
            removeCachedAvatar(previousUid);
        }
    }

    const UserContext = createContext({
        ...defaultUser,
        blockedSet: new Set(),
        chatBanned: false,
        avatarBanned: false,
        chatBanUntil: null,
        isBlocked: () => false,
        blockPeer: async () => {},
        unblockPeer: async () => {},
        acceptCommunityRules: async () => {},
        updateSettings: async () => {},
        refetchAvatar: () => {},
        clearAvatar: () => {},
    });

    function UserProvider({ children }) {
        const [user, setUser] = useState(defaultUser);
        const avatarFetchRef = useRef({ uid: null, key: null, promise: null });
        const authSessionRef = useRef(0);
        const avatarCacheUidRef = useRef(null);

        const fetchAvatar = useCallback(
            async (uid, { version = null, force = false, clear = false, persist = true } = {}) => {
                if (!uid) return;
                const avatarVersion = readAvatarVersion(version);
                const startedAt = Date.now();
                if (clear) {
                    markDiag(diag, 'user.avatar.clear.start', {});
                    avatarFetchRef.current = { uid: null, key: null, promise: null };
                    removeCachedAvatar(uid);
                    setUser((prevUser) => (prevUser.avatar == null && prevUser.avatarVersion == null ? prevUser : { ...prevUser, avatar: null, avatarVersion: null }));
                    markDone(diag, 'user.avatar.clear', startedAt);
                    return null;
                }

                const key = avatarVersion == null ? 'unknown' : String(avatarVersion);
                const cached = avatarFetchRef.current;
                if (!force && cached.uid === uid && cached.key === key && cached.promise) {
                    markDiag(diag, 'user.avatar.fetch.reuse', { hasVersion: avatarVersion != null });
                    return cached.promise;
                }

                markDiag(diag, 'user.avatar.fetch.start', { force: !!force, persist: !!persist, hasVersion: avatarVersion != null });
                try {
                    const promise = (async () => {
                        const cachedAvatar = avatarVersion == null ? null : await readCachedAvatar(uid, avatarVersion);
                        if (cachedAvatar) {
                            markDiag(diag, 'user.avatar.cache.hit', { elapsedMs: Date.now() - startedAt });
                            return cachedAvatar.url;
                        }

                        const storage = resolveStorage();
                        if (!storage) return null;
                        if (persist && avatarVersion != null) {
                            const bytes = await readFile(storage, avatarPath(uid));
                            const cachedSource = await writeCachedAvatar(uid, { version: avatarVersion, bytes });
                            if (cachedSource) {
                                return cachedSource;
                            }
                        }

                        const avatarUrl = await getFileUrl(storage, avatarPath(uid));
                        return avatarUrlWithVersion(avatarUrl, avatarVersion);
                    })().then((nextAvatar) => {
                        markDone(diag, 'user.avatar.fetch', startedAt, { found: !!nextAvatar, hasVersion: avatarVersion != null });
                        if (!nextAvatar) {
                            return null;
                        }
                        if (avatarFetchRef.current.uid !== uid || avatarFetchRef.current.key !== key) {
                            return nextAvatar;
                        }
                        setUser((prevUser) => {
                            const nextVersion = avatarVersion ?? prevUser.avatarVersion;
                            if (prevUser.avatar === nextAvatar && prevUser.avatarVersion === nextVersion) {
                                return prevUser;
                            }
                            return { ...prevUser, avatar: nextAvatar, avatarVersion: nextVersion };
                        });
                        return nextAvatar;
                    });
                    avatarFetchRef.current = { uid, key, promise };
                    return await promise;
                } catch (error) {
                    markError(diag, 'user.avatar.fetch', startedAt, error, { hasVersion: avatarVersion != null });
                    const isCurrentFetch = avatarFetchRef.current.uid === uid && avatarFetchRef.current.key === key;
                    if (isCurrentFetch) {
                        avatarFetchRef.current = { uid: null, key: null, promise: null };
                    }
                    if (error?.code === 'storage/object-not-found') {
                        if (!isCurrentFetch) {
                            return null;
                        }
                        removeCachedAvatar(uid);
                        setUser((prevUser) => (prevUser.avatar == null ? prevUser : { ...prevUser, avatar: null }));
                        return null;
                    }
                    console.warn('failed to fetch avatar', error);
                    return null;
                }
            },
            [diag, getStorage, storage]
        );

        const clearAvatar = useCallback(() => {
            avatarFetchRef.current = { uid: null, key: null, promise: null };
            removeCachedAvatar(auth.currentUser?.uid);
            setUser((prevUser) => {
                if (prevUser.avatar == null && prevUser.avatarVersion == null) {
                    return prevUser;
                }
                return { ...prevUser, avatar: null, avatarVersion: null };
            });
        }, [auth]);

        useEffect(() => {
            let unsubscribePrivate = () => {};
            let unsubscribeAdmin = () => {};
            let unsubscribeModeration = () => {};
            let unsubscribeProfile = () => {};
            let unsubscribeBlocked = () => {};

            const unsubscribeAuth = onAuthStateChanged(auth, (authUser) => {
                const authStartedAt = Date.now();
                const authSession = authSessionRef.current + 1;
                authSessionRef.current = authSession;
                unsubscribePrivate();
                unsubscribeAdmin();
                unsubscribeModeration();
                unsubscribeProfile();
                unsubscribeBlocked();
                markDiag(diag, 'user.auth.state', { signedIn: !!authUser });

                if (!authUser) {
                    keepOnlyCachedAvatar(null, avatarCacheUidRef.current);
                    avatarCacheUidRef.current = null;
                    avatarFetchRef.current = { uid: null, key: null, promise: null };
                    setUser({ ...defaultUser, authReady: true });
                    return;
                }

                keepOnlyCachedAvatar(authUser.uid, avatarCacheUidRef.current);
                avatarCacheUidRef.current = authUser.uid;

                setUser((prevUser) => (
                    prevUser.uid === authUser.uid
                        ? { ...prevUser, authReady: true, isAdmin: false, adminReady: false }
                        : { ...defaultUser, authReady: true, uid: authUser.uid }
                ));
                void readCachedAvatar(authUser.uid).then((cached) => {
                    if (!cached || authSessionRef.current !== authSession || auth.currentUser?.uid !== authUser.uid) {
                        return;
                    }
                    setUser((prevUser) => {
                        if (prevUser.uid !== authUser.uid || prevUser.avatar) {
                            return prevUser;
                        }
                        if (prevUser.avatarVersion != null && prevUser.avatarVersion !== cached.version) {
                            return prevUser;
                        }
                        return { ...prevUser, avatar: cached.url, avatarVersion: cached.version };
                    });
                });

                unsubscribeAdmin = onSnapshot(
                    doc(db, 'admins', authUser.uid),
                    (adminSnap) => {
                        setUser((prevUser) => ({
                            ...prevUser,
                            isAdmin: adminSnap.exists(),
                            adminReady: true,
                        }));
                    },
                    (error) => {
                        console.warn('failed to subscribe admin access', error);
                        setUser((prevUser) => ({
                            ...prevUser,
                            isAdmin: false,
                            adminReady: true,
                        }));
                    }
                );

                unsubscribePrivate = onSnapshot(
                    doc(db, 'users', authUser.uid),
                    { includeMetadataChanges: true },
                    (privateSnap) => {
                        markDiag(diag, 'user.settings.snapshot', {
                            elapsedMs: Date.now() - authStartedAt,
                            exists: privateSnap.exists(),
                            fromCache: privateSnap.metadata.fromCache,
                            pending: privateSnap.metadata.hasPendingWrites,
                        });
                        const privateData = privateSnap.exists() ? privateSnap.data() : {};
                        const { autolock: rawAutolock, ...rawSettings } = privateData.settings || {};
                        setUser((prevUser) => ({
                            ...prevUser,
                            communityRulesVersion: privateData.communityRulesVersion ?? null,
                            communityRulesDate: privateData.communityRulesDate ?? null,
                            communityRulesAcceptedAt: privateData.communityRulesAcceptedAt ?? null,
                            communityRulesPending: privateSnap.metadata.hasPendingWrites,
                            settingsReady: prevUser.settingsReady || !privateSnap.metadata.fromCache,
                            settings: {
                                ...defaultUser.settings,
                                ...rawSettings,
                                ghostWallet: defaultUser.settings.ghostWallet,
                                autolock: {
                                    ...defaultUser.settings.autolock,
                                    ...(rawAutolock || {}),
                                },
                            },
                        }));
                    },
                    (error) => {
                        markError(diag, 'user.settings.snapshot', authStartedAt, error);
                        console.warn('failed to subscribe user settings', error);
                        setUser((prevUser) => ({
                            ...prevUser,
                            settingsReady: true,
                            communityRulesVersion: null,
                            communityRulesDate: null,
                            communityRulesAcceptedAt: null,
                            communityRulesPending: false,
                            settings: {
                                ...defaultUser.settings,
                                autolock: {
                                    ...defaultUser.settings.autolock,
                                },
                            },
                        }));
                    }
                );

                unsubscribeModeration = onSnapshot(
                    doc(db, 'moderation', authUser.uid),
                    (moderationSnap) => {
                        const moderationData = moderationSnap.exists() ? moderationSnap.data() : {};
                        setUser((prevUser) => ({
                            ...prevUser,
                            banned: moderationData?.banned ?? null,
                        }));
                    },
                    (error) => {
                        console.warn('failed to subscribe moderation', error);
                        setUser((prevUser) => ({ ...prevUser, banned: null }));
                    }
                );

                unsubscribeBlocked = onSnapshot(
                    collection(db, 'users', authUser.uid, 'blocked'),
                    (blockedSnap) => {
                        const blocked = blockedSnap.docs
                            .map((item) => item.id)
                            .filter(Boolean)
                            .sort();

                        setUser((prevUser) => {
                            if (prevUser.blockedReady && prevUser.blocked.length === blocked.length && prevUser.blocked.every((id, i) => id === blocked[i])) {
                                return prevUser;
                            }
                            return { ...prevUser, blockedReady: true, blocked };
                        });
                    },
                    (error) => {
                        console.warn('failed to subscribe blocked users', error);
                        setUser((prevUser) => ({ ...prevUser, blockedReady: true, blocked: [] }));
                    }
                );

                unsubscribeProfile = onSnapshot(
                    doc(db, 'profiles', authUser.uid),
                    (profileSnap) => {
                        markDiag(diag, 'user.profile.snapshot', {
                            elapsedMs: Date.now() - authStartedAt,
                            exists: profileSnap.exists(),
                        });
                        const profileData = profileSnap.exists() ? profileSnap.data() : {};
                        setUser((prevUser) => {
                            const username = profileData.username || null;
                            const walletPKs = profileData.walletPKs || null;
                            const walletPK = resolveWalletPK(profileData, network);
                            const chatPK = profileData.chatPK || null;
                            const active = profileData.active ?? false;
                            const hasAvatarEntry = profileSnap.exists() && Object.prototype.hasOwnProperty.call(profileData, 'avatar');
                            const avatarVersion = readAvatarVersion(profileData.avatar);
                            const avatar = avatarVersion == null ? null : prevUser.avatar;
                            if (
                                prevUser.profileReady &&
                                prevUser.uid === authUser.uid &&
                                prevUser.username === username &&
                                prevUser.walletPK === walletPK &&
                                prevUser.walletPKs === walletPKs &&
                                prevUser.chatPK === chatPK &&
                                prevUser.active === active &&
                                prevUser.hasAvatarEntry === hasAvatarEntry &&
                                prevUser.avatarVersion === avatarVersion &&
                                prevUser.avatar === avatar
                            ) {
                                return prevUser;
                            }
                            return { ...prevUser, uid: authUser.uid, profileReady: true, username, walletPKs, walletPK, chatPK, active, hasAvatarEntry, avatarVersion, avatar };
                        });
                        const avatarVersion = readAvatarVersion(profileData.avatar);
                        if (avatarVersion == null) {
                            void fetchAvatar(authUser.uid, { clear: true });
                        } else if (profileSnap.exists()) {
                            void fetchAvatar(authUser.uid, { version: avatarVersion });
                        }
                    },
                    (error) => {
                        markError(diag, 'user.profile.snapshot', authStartedAt, error);
                        console.warn('failed to subscribe profile', error);
                        avatarFetchRef.current = { uid: null, key: null, promise: null };
                        setUser((prevUser) => ({
                            ...prevUser,
                            uid: authUser.uid,
                            profileReady: true,
                            username: null,
                            walletPKs: null,
                            walletPK: null,
                            chatPK: null,
                            active: false,
                            avatarVersion: null,
                            avatar: null,
                            hasAvatarEntry: false,
                        }));
                    }
                );
            });

            return () => {
                unsubscribePrivate();
                unsubscribeAdmin();
                unsubscribeModeration();
                unsubscribeProfile();
                unsubscribeBlocked();
                unsubscribeAuth();
            };
        }, [auth, db, diag, fetchAvatar, network]);

        useEffect(() => {
            const untilMs = [getBanUntilMs(user?.banned?.full), getBanUntilMs(user?.banned?.chat)].filter((value) => Number.isFinite(value) && value > Date.now()).sort((a, b) => a - b)[0];

            if (!untilMs) {
                return;
            }

            const timerId = setTimeout(
                () => {
                    setUser((prevUser) => ({ ...prevUser }));
                },
                Math.max(untilMs - Date.now(), 0) + 50
            );

            return () => clearTimeout(timerId);
        }, [user?.banned?.avatar, user?.banned?.chat, user?.banned?.full]);

        const blockedSet = useMemo(() => new Set(user.blocked), [user.blocked]);
        const activeFullBan = useMemo(() => getActiveBan(user?.banned?.full), [user?.banned?.full]);
        const activeChatBan = useMemo(() => getActiveBan(user?.banned?.chat), [user?.banned?.chat]);
        const activeAvatarBan = useMemo(() => getActiveBan(user?.banned?.avatar), [user?.banned?.avatar]);
        const activeBan = activeFullBan || activeChatBan;
        const chatBanUntil = useMemo(() => activeBan?.until ?? null, [activeBan]);
        const chatBanned = !!activeBan;
        const avatarBanned = !!(activeFullBan || activeAvatarBan);

        const blockPeer = useCallback(
            async (peer) => {
                const peerUid = typeof peer === 'string' ? peer.trim() : typeof peer?.uid === 'string' ? peer.uid.trim() : '';
                const uid = auth.currentUser?.uid;
                if (!uid) throw new Error('auth');
                if (!peerUid) throw new Error('peer uid required');
                if (peerUid === uid) return;
                await setDoc(doc(db, 'users', uid, 'blocked', peerUid), {});
            },
            [auth, db]
        );

        const unblockPeer = useCallback(
            async (peer) => {
                const peerUid = typeof peer === 'string' ? peer.trim() : typeof peer?.uid === 'string' ? peer.uid.trim() : '';
                const uid = auth.currentUser?.uid;
                if (!uid) throw new Error('auth');
                if (!peerUid) throw new Error('peer uid required');
                await deleteDoc(doc(db, 'users', uid, 'blocked', peerUid));
            },
            [auth, db]
        );

        const acceptCommunityRules = useCallback(
            async (version) => {
                const uid = auth.currentUser?.uid;
                const nextVersion = typeof version === 'string' ? version.trim() : '';
                if (!uid) throw new Error('auth');
                if (!nextVersion) throw new Error('community rules version required');
                await setDoc(
                    doc(db, 'users', uid),
                    {
                        communityRulesVersion: nextVersion,
                        ...(nextVersion === COMMUNITY_RULES_VERSION ? { communityRulesDate: COMMUNITY_RULES_DATE } : {}),
                        communityRulesAcceptedAt: serverTimestamp(),
                    },
                    { merge: true }
                );
                setUser((prevUser) => ({
                    ...prevUser,
                    communityRulesVersion: nextVersion,
                    communityRulesDate: nextVersion === COMMUNITY_RULES_VERSION ? COMMUNITY_RULES_DATE : prevUser.communityRulesDate,
                    communityRulesAcceptedAt: new Date(),
                    communityRulesPending: false,
                }));
            },
            [auth, db]
        );

        const updateSettings = useCallback(
            async (patch) => {
                const uid = auth.currentUser?.uid;
                if (!uid) throw new Error('auth');

                const nextSettings = await writeUserSettings({
                    db,
                    uid,
                    settings: patch,
                    currentSettings: user.settings,
                });
                setUser((prevUser) => ({
                    ...prevUser,
                    settingsReady: true,
                    settings: nextSettings,
                }));
                return nextSettings;
            },
            [auth, db, user.settings]
        );

        const isBlocked = useCallback(
            (peer) => {
                const peerUid = typeof peer === 'string' ? peer.trim() : typeof peer?.uid === 'string' ? peer.uid.trim() : '';
                return !!peerUid && blockedSet.has(peerUid);
            },
            [blockedSet]
        );

        const refetchAvatar = useCallback((options = {}) => {
            const optimistic = options?.optimistic === true;
            const nextVersion = optimistic && user.avatarVersion != null ? user.avatarVersion + 1 : user.avatarVersion;
            return fetchAvatar(user.uid, { force: true, persist: !optimistic, version: nextVersion });
        }, [fetchAvatar, user.avatarVersion, user.uid]);

        const value = useMemo(
            () => ({
                ...user,
                blockedSet,
                chatBanned,
                avatarBanned,
                chatBanUntil,
                isBlocked,
                blockPeer,
                unblockPeer,
                acceptCommunityRules,
                updateSettings,
                refetchAvatar,
                clearAvatar,
            }),
            [acceptCommunityRules, avatarBanned, blockPeer, blockedSet, chatBanned, chatBanUntil, clearAvatar, isBlocked, refetchAvatar, unblockPeer, updateSettings, user]
        );

        return <UserContext value={value}>{children}</UserContext>;
    }

    const useUser = () => useContext(UserContext);

    return { UserProvider, useUser, UserContext };
}
