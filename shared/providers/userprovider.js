'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { readAvatarVersion } from '../avatar.js';
import { BAN_REFRESH_GRACE_MS } from '../config.js';
import { COMMUNITY_RULES_DATE, COMMUNITY_RULES_VERSION } from '../community.js';
import { markDiag, markDone, markError } from '../utils/diagnostics.js';
import { banState, nextBanRefreshMs } from '../moderation.js';
import { peerUid } from '../profile.js';
import { defaultSettings } from '../settings.js';
import { clearSettingsKey } from '../settingscloud.js';
import { cleanText } from '../utils/text.js';
import { resolveWalletPK } from '../wallet/keys.js';

function settingsState(settings = defaultSettings) {
    return {
        ...defaultSettings,
        ...(settings || {}),
        ghostWallet: defaultSettings.ghostWallet,
        autolock: {
            ...defaultSettings.autolock,
            ...(settings?.autolock || {}),
        },
    };
}

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
    settings: settingsState(),
};

export function createUserProvider({ cloud, network, avatarCache = null, diag = null }) {
    if (!cloud) {
        throw new Error('createUserProvider requires { cloud }');
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
        unlockSettings: async () => {},
        lockSettings: () => {},
        updateSettings: async () => {},
        refetchAvatar: () => {},
        clearAvatar: () => {},
    });

    function UserProvider({ children }) {
        const [user, setUser] = useState(defaultUser);
        const avatarFetchRef = useRef({ uid: null, key: null, promise: null });
        const authSessionRef = useRef(0);
        const avatarCacheUidRef = useRef(null);
        const settingsKeyRef = useRef(null);
        const userUidRef = useRef(null);

        const clearUnlockedSettings = useCallback(() => {
            clearSettingsKey(settingsKeyRef.current);
            settingsKeyRef.current = null;
            setUser((prevUser) => ({
                ...prevUser,
                settings: settingsState(),
            }));
        }, []);

        const setSettingsKey = useCallback((key) => {
            clearSettingsKey(settingsKeyRef.current);
            settingsKeyRef.current = key ? new Uint8Array(key) : null;
            return settingsKeyRef.current;
        }, []);

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
                        const nextAvatar = await cloud.peer.avatar.url(uid, { version: avatarVersion });

                        if (persist && avatarVersion != null) {
                            void cloud.peer.avatar
                                .read(uid)
                                .then((bytes) => writeCachedAvatar(uid, { version: avatarVersion, bytes }))
                                .catch(() => {});
                        }

                        return nextAvatar;
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
            [cloud, diag]
        );

        const clearAvatar = useCallback(() => {
            avatarFetchRef.current = { uid: null, key: null, promise: null };
            removeCachedAvatar(cloud.auth.user?.uid);
            setUser((prevUser) => {
                if (prevUser.avatar == null && prevUser.avatarVersion == null) {
                    return prevUser;
                }
                return { ...prevUser, avatar: null, avatarVersion: null };
            });
        }, [cloud]);

        useEffect(() => {
            let unsubscribePrivate = () => {};
            let unsubscribeAdmin = () => {};
            let unsubscribeModeration = () => {};
            let unsubscribeProfile = () => {};
            let unsubscribeBlocked = () => {};

            const unsubscribeAuth = cloud.auth.watch((authUser) => {
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
                    userUidRef.current = null;
                    clearSettingsKey(settingsKeyRef.current);
                    settingsKeyRef.current = null;
                    keepOnlyCachedAvatar(null, avatarCacheUidRef.current);
                    avatarCacheUidRef.current = null;
                    avatarFetchRef.current = { uid: null, key: null, promise: null };
                    setUser({ ...defaultUser, authReady: true });
                    return;
                }

                keepOnlyCachedAvatar(authUser.uid, avatarCacheUidRef.current);
                avatarCacheUidRef.current = authUser.uid;

                const authUidChanged = userUidRef.current !== authUser.uid;
                userUidRef.current = authUser.uid;
                if (authUidChanged) {
                    clearSettingsKey(settingsKeyRef.current);
                    settingsKeyRef.current = null;
                }
                setUser((prevUser) => (
                    authUidChanged
                        ? { ...defaultUser, authReady: true, uid: authUser.uid }
                        : { ...prevUser, authReady: true, isAdmin: false, adminReady: false }
                ));
                void readCachedAvatar(authUser.uid).then((cached) => {
                    if (!cached || authSessionRef.current !== authSession || cloud.auth.user?.uid !== authUser.uid) {
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

                unsubscribeAdmin = cloud.user.admin.watch(
                    authUser.uid,
                    (allowed) => {
                        setUser((prevUser) => ({
                            ...prevUser,
                            isAdmin: allowed,
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

                unsubscribePrivate = cloud.user.private.watch(
                    authUser.uid,
                    (privateData, info = {}) => {
                        markDiag(diag, 'user.settings.snapshot', {
                            elapsedMs: Date.now() - authStartedAt,
                            exists: !!info.exists,
                            fromCache: !!info.fromCache,
                            pending: !!info.pending,
                        });
                        setUser((prevUser) => ({
                            ...prevUser,
                            communityRulesVersion: privateData.communityRulesVersion ?? null,
                            communityRulesDate: privateData.communityRulesDate ?? null,
                            communityRulesAcceptedAt: privateData.communityRulesAcceptedAt ?? null,
                            communityRulesPending: !!info.pending,
                            settingsReady: prevUser.settingsReady || !info.fromCache,
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
                        }));
                    }
                );

                unsubscribeModeration = cloud.user.banned(
                    authUser.uid,
                    (banned) => {
                        setUser((prevUser) => ({
                            ...prevUser,
                            banned: banned ?? null,
                        }));
                    },
                    (error) => {
                        console.warn('failed to subscribe moderation', error);
                        setUser((prevUser) => ({ ...prevUser, banned: null }));
                    }
                );

                unsubscribeBlocked = cloud.user.blocked.watch(
                    authUser.uid,
                    (blocked) => {
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

                unsubscribeProfile = cloud.user.profile.watch(
                    authUser.uid,
                    (profileData, info = {}) => {
                        markDiag(diag, 'user.profile.snapshot', {
                            elapsedMs: Date.now() - authStartedAt,
                            exists: !!info.exists,
                        });
                        setUser((prevUser) => {
                            const username = profileData.username || null;
                            const walletPKs = profileData.walletPKs || null;
                            const walletPK = resolveWalletPK(profileData, network);
                            const chatPK = profileData.chatPK || null;
                            const active = profileData.active ?? false;
                            const hasAvatarEntry = !!info.exists && Object.prototype.hasOwnProperty.call(profileData, 'avatar');
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
                        } else if (info.exists) {
                            void (async () => {
                                const cached = await readCachedAvatar(authUser.uid, avatarVersion);
                                if (cached && authSessionRef.current === authSession && cloud.auth.user?.uid === authUser.uid) {
                                    avatarFetchRef.current = { uid: authUser.uid, key: String(avatarVersion), promise: Promise.resolve(cached.url) };
                                    setUser((prevUser) => {
                                        if (prevUser.uid !== authUser.uid) {
                                            return prevUser;
                                        }
                                        if (prevUser.avatar === cached.url && prevUser.avatarVersion === cached.version) {
                                            return prevUser;
                                        }
                                        return { ...prevUser, avatar: cached.url, avatarVersion: cached.version };
                                    });
                                    return;
                                }
                                await fetchAvatar(authUser.uid, { version: avatarVersion });
                            })();
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
        }, [cloud, diag, fetchAvatar, network]);

        useEffect(() => {
            const untilMs = nextBanRefreshMs(user?.banned);
            if (!untilMs) {
                return;
            }

            const timerId = setTimeout(
                () => {
                    setUser((prevUser) => ({ ...prevUser }));
                },
                Math.max(untilMs - Date.now(), 0) + BAN_REFRESH_GRACE_MS
            );

            return () => clearTimeout(timerId);
        }, [user?.banned?.avatar, user?.banned?.chat, user?.banned?.full]);

        const blockedSet = useMemo(() => new Set(user.blocked), [user.blocked]);
        const bans = useMemo(() => banState(user?.banned), [user?.banned]);
        const userBan = bans.full || bans.chat;
        const chatBanUntil = useMemo(() => userBan?.until ?? null, [userBan]);
        const chatBanned = bans.chatBanned;
        const avatarBanned = bans.avatarBanned;

        const blockPeer = useCallback(
            async (peer) => {
                const nextPeerUid = peerUid(peer);
                const uid = cloud.auth.user?.uid;
                if (!uid) throw new Error('auth');
                if (!nextPeerUid) throw new Error('peer uid required');
                if (nextPeerUid === uid) return;
                await cloud.user.blocked.add(uid, nextPeerUid);
            },
            [cloud]
        );

        const unblockPeer = useCallback(
            async (peer) => {
                const nextPeerUid = peerUid(peer);
                const uid = cloud.auth.user?.uid;
                if (!uid) throw new Error('auth');
                if (!nextPeerUid) throw new Error('peer uid required');
                await cloud.user.blocked.remove(uid, nextPeerUid);
            },
            [cloud]
        );

        const acceptCommunityRules = useCallback(
            async (version) => {
                const uid = cloud.auth.user?.uid;
                const nextVersion = cleanText(version);
                if (!uid) throw new Error('auth');
                if (!nextVersion) throw new Error('community rules version required');
                await cloud.user.community.accept(uid, {
                    version: nextVersion,
                    ...(nextVersion === COMMUNITY_RULES_VERSION ? { date: COMMUNITY_RULES_DATE } : {}),
                });
                setUser((prevUser) => ({
                    ...prevUser,
                    communityRulesVersion: nextVersion,
                    communityRulesDate: nextVersion === COMMUNITY_RULES_VERSION ? COMMUNITY_RULES_DATE : prevUser.communityRulesDate,
                    communityRulesAcceptedAt: new Date(),
                    communityRulesPending: false,
                }));
            },
            [cloud]
        );

        const unlockSettings = useCallback(
            async (key) => {
                const uid = cloud.auth.user?.uid;
                if (!uid) throw new Error('auth');
                if (!key) throw new Error('settings key required');
                const nextSettings = await cloud.user.settings.read(uid, key);
                setSettingsKey(key);
                setUser((prevUser) => ({
                    ...prevUser,
                    settingsReady: true,
                    settings: settingsState(nextSettings),
                }));
                return nextSettings;
            },
            [cloud, setSettingsKey]
        );

        const lockSettings = useCallback(() => {
            clearUnlockedSettings();
        }, [clearUnlockedSettings]);

        const updateSettings = useCallback(
            async (patch) => {
                const uid = cloud.auth.user?.uid;
                if (!uid) throw new Error('auth');
                const settingsKey = settingsKeyRef.current;
                if (!settingsKey) throw new Error('settings locked');

                const nextSettings = await cloud.user.settings.write(uid, patch, { currentSettings: user.settings, key: settingsKey });
                setUser((prevUser) => ({
                    ...prevUser,
                    settingsReady: true,
                    settings: settingsState(nextSettings),
                }));
                return nextSettings;
            },
            [cloud, user.settings]
        );

        const isBlocked = useCallback(
            (peer) => {
                const nextPeerUid = peerUid(peer);
                return !!nextPeerUid && blockedSet.has(nextPeerUid);
            },
            [blockedSet]
        );

        const refetchAvatar = useCallback((options = {}) => {
            const requestedVersion = readAvatarVersion(options?.version);
            const optimistic = options?.optimistic === true;
            const nextVersion = requestedVersion ?? (optimistic && user.avatarVersion != null ? user.avatarVersion + 1 : user.avatarVersion);
            const persist = options?.persist ?? !(optimistic && requestedVersion == null);
            return fetchAvatar(user.uid, { force: true, persist, version: nextVersion });
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
                unlockSettings,
                lockSettings,
                updateSettings,
                refetchAvatar,
                clearAvatar,
            }),
            [acceptCommunityRules, avatarBanned, blockPeer, blockedSet, chatBanned, chatBanUntil, clearAvatar, isBlocked, lockSettings, refetchAvatar, unblockPeer, unlockSettings, updateSettings, user]
        );

        return <UserContext value={value}>{children}</UserContext>;
    }

    const useUser = () => useContext(UserContext);

    return { UserProvider, useUser, UserContext };
}
