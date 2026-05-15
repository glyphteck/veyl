'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { avatarPath, getFileUrl } from '../files.js';
import { COMMUNITY_RULES_DATE, COMMUNITY_RULES_VERSION } from '../community.js';
import { defaultSettings, writeUserSettings } from '../settings.js';
import { resolveWalletPK } from '../walletkeys.js';

export const defaultUser = {
    uid: null,
    authReady: false,
    username: null,
    avatar: null,
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

export function createUserProvider({ auth, db, storage, getStorage, network }) {
    if (!auth || !db) {
        throw new Error('createUserProvider requires { auth, db }');
    }

    function resolveStorage() {
        return typeof getStorage === 'function' ? getStorage() : storage;
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
    });

    function UserProvider({ children }) {
        const [user, setUser] = useState(defaultUser);

        const fetchAvatar = useCallback(
            async (uid, { bust = false } = {}) => {
                if (!uid) return;
                try {
                    const storage = resolveStorage();
                    if (!storage) return;
                    const avatarUrl = await getFileUrl(storage, avatarPath(uid));
                    const nextAvatar = bust ? `${avatarUrl}${avatarUrl.includes('?') ? '&' : '?'}t=${Date.now()}` : avatarUrl;
                    setUser((prevUser) => (prevUser.avatar === nextAvatar ? prevUser : { ...prevUser, avatar: nextAvatar }));
                } catch (error) {
                    if (error?.code === 'storage/object-not-found') {
                        setUser((prevUser) => (prevUser.avatar == null ? prevUser : { ...prevUser, avatar: null }));
                        return;
                    }
                    console.warn('failed to fetch avatar', error);
                }
            },
            [getStorage, storage]
        );

        useEffect(() => {
            let unsubscribePrivate = () => {};
            let unsubscribeAdmin = () => {};
            let unsubscribeModeration = () => {};
            let unsubscribeProfile = () => {};
            let unsubscribeBlocked = () => {};

            const unsubscribeAuth = onAuthStateChanged(auth, (authUser) => {
                unsubscribePrivate();
                unsubscribeAdmin();
                unsubscribeModeration();
                unsubscribeProfile();
                unsubscribeBlocked();

                if (!authUser) {
                    setUser({ ...defaultUser, authReady: true });
                    return;
                }

                setUser((prevUser) => (
                    prevUser.uid === authUser.uid
                        ? { ...prevUser, authReady: true, isAdmin: false, adminReady: false }
                        : { ...defaultUser, authReady: true, uid: authUser.uid }
                ));

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
                                autolock: {
                                    ...defaultUser.settings.autolock,
                                    ...(rawAutolock || {}),
                                },
                            },
                        }));
                    },
                    (error) => {
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
                        const profileData = profileSnap.exists() ? profileSnap.data() : {};
                        setUser((prevUser) => {
                            const username = profileData.username || null;
                            const walletPKs = profileData.walletPKs || null;
                            const walletPK = resolveWalletPK(profileData, network);
                            const chatPK = profileData.chatPK || null;
                            const active = profileData.active ?? false;
                            if (
                                prevUser.uid === authUser.uid &&
                                prevUser.username === username &&
                                prevUser.walletPK === walletPK &&
                                prevUser.walletPKs === walletPKs &&
                                prevUser.chatPK === chatPK &&
                                prevUser.active === active
                            ) {
                                return prevUser;
                            }
                            return { ...prevUser, uid: authUser.uid, username, walletPKs, walletPK, chatPK, active };
                        });
                        fetchAvatar(authUser.uid);
                    },
                    (error) => {
                        console.warn('failed to subscribe profile', error);
                        setUser((prevUser) => ({
                            ...prevUser,
                            uid: authUser.uid,
                            username: null,
                            walletPKs: null,
                            walletPK: null,
                            chatPK: null,
                            active: false,
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
        }, [auth, db, fetchAvatar, network]);

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
                refetchAvatar: () => fetchAvatar(user.uid, { bust: true }),
            }),
            [acceptCommunityRules, avatarBanned, blockPeer, blockedSet, chatBanned, chatBanUntil, fetchAvatar, isBlocked, unblockPeer, updateSettings, user]
        );

        return <UserContext value={value}>{children}</UserContext>;
    }

    const useUser = () => useContext(UserContext);

    return { UserProvider, useUser, UserContext };
}
