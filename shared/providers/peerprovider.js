'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { readCachedProfiles, writeCachedProfiles } from '../localdatacache.js';

export function createPeerProvider({ useChat, useUser, useTxData, useVault, peerApi }) {
    if (typeof useChat !== 'function' || typeof useUser !== 'function' || typeof useTxData !== 'function' || typeof useVault !== 'function') {
        throw new Error('createPeerProvider requires { useChat, useUser, useTxData, useVault, peerApi }');
    }
    if (!peerApi) {
        throw new Error('createPeerProvider requires peerApi');
    }

    const { loadProfiles, assemblePeers, fetchAndCachePeer, updatePeerByUID, hydrateProfiles, getCachedProfiles } = peerApi;
    const PeerContext = createContext(null);

    function getPeerUid(peer) {
        return typeof peer === 'string' ? peer.trim() : typeof peer?.uid === 'string' ? peer.uid.trim() : '';
    }

    function PeerProvider({ children }) {
        const { peers: chatPeers, chats } = useChat();
        const { blocked, blockedReady, chatPK, blockedSet } = useUser();
        const { peers: walletPeers } = useTxData();
        const { localCache } = useVault();

        const [profilesReady, setProfilesReady] = useState(false);
        const [discoveredPeerUids, setDiscoveredPeerUids] = useState([]);
        const [hiddenPeerUids, setHiddenPeerUids] = useState([]);
        const [blockedPeers, setBlockedPeers] = useState([]);
        const [blockedPeersReady, setBlockedPeersReady] = useState(false);
        const [peerRefreshTick, setPeerRefreshTick] = useState(0);

        const seenWalletPKsRef = useRef(new Set());
        const seenChatPKsRef = useRef(new Set());
        const lastPeersRef = useRef([]);
        const blockedPeersRef = useRef([]);
        const hydratedProfileCacheKeyRef = useRef('');
        const walletPKsKey = useMemo(
            () =>
                JSON.stringify(
                    Object.keys(walletPeers || {})
                        .filter(Boolean)
                        .sort()
                ),
            [walletPeers]
        );
        const chatPeerPKsKey = useMemo(() => JSON.stringify((Array.isArray(chatPeers) ? chatPeers.filter(Boolean) : []).slice().sort()), [chatPeers]);

        useEffect(() => {
            blockedPeersRef.current = blockedPeers;
        }, [blockedPeers]);

        useEffect(() => {
            if (chatPK) return;
            seenWalletPKsRef.current = new Set();
            seenChatPKsRef.current = new Set();
            lastPeersRef.current = [];
            hydratedProfileCacheKeyRef.current = '';
            setProfilesReady(false);
            setDiscoveredPeerUids([]);
            setHiddenPeerUids([]);
            setBlockedPeers([]);
            setBlockedPeersReady(false);
            setPeerRefreshTick(0);
        }, [chatPK]);

        useEffect(() => {
            if (!chatPK || !localCache || typeof hydrateProfiles !== 'function') {
                hydratedProfileCacheKeyRef.current = '';
                return;
            }

            const cacheKey = `${localCache.id}:${chatPK}`;
            if (hydratedProfileCacheKeyRef.current === cacheKey) {
                return;
            }
            hydratedProfileCacheKeyRef.current = cacheKey;

            const count = hydrateProfiles(readCachedProfiles(localCache));
            if (count > 0) {
                setPeerRefreshTick((tick) => tick + 1);
            }
        }, [chatPK, hydrateProfiles, localCache]);

        useEffect(() => {
            const seenWalletPKs = seenWalletPKsRef.current;
            const seenChatPKs = seenChatPKsRef.current;
            const walletPKs = walletPKsKey ? JSON.parse(walletPKsKey) : [];
            const nextChatPKs = chatPeerPKsKey ? JSON.parse(chatPeerPKsKey) : [];

            const newWalletPKs = walletPKs.filter((key) => key && !seenWalletPKs.has(key));
            const newChatPKs = nextChatPKs.filter((key) => key && !seenChatPKs.has(key));

            if (!newWalletPKs.length && !newChatPKs.length) {
                setProfilesReady((prev) => (prev ? prev : true));
                return;
            }

            let cancelled = false;
            setProfilesReady((prev) => (prev ? false : prev));

            loadProfiles(newWalletPKs, newChatPKs)
                .then(() => {
                    if (cancelled) return;
                    newWalletPKs.forEach((key) => seenWalletPKs.add(key));
                    newChatPKs.forEach((key) => seenChatPKs.add(key));
                    setProfilesReady(true);
                })
                .catch((error) => {
                    if (!cancelled) {
                        console.warn('Error loading profiles:', error);
                        setProfilesReady(true);
                    }
                });

            return () => {
                cancelled = true;
            };
        }, [chatPeerPKsKey, loadProfiles, walletPKsKey]);

        const addPeer = useCallback(
            async (partialProfile) => {
                if (!partialProfile) return null;

                let stats = null;
                if (partialProfile.walletPK && walletPeers?.[partialProfile.walletPK]) {
                    stats = walletPeers[partialProfile.walletPK].stats;
                }

                const enrichedPeer = await fetchAndCachePeer(partialProfile, stats);
                if (!enrichedPeer) return null;
                if (blockedSet?.has?.(enrichedPeer.uid) || hiddenPeerUids.includes(enrichedPeer.uid)) return null;

                setDiscoveredPeerUids((prev) => (prev.includes(enrichedPeer.uid) ? prev : [...prev, enrichedPeer.uid]));
                return enrichedPeer;
            },
            [blockedSet, hiddenPeerUids, walletPeers]
        );

        const primePeer = useCallback(
            async (partialProfile) => {
                if (!partialProfile) return null;

                let stats = null;
                if (partialProfile.walletPK && walletPeers?.[partialProfile.walletPK]) {
                    stats = walletPeers[partialProfile.walletPK].stats;
                }

                const enrichedPeer = await fetchAndCachePeer(partialProfile, stats);
                if (!enrichedPeer?.uid) return null;

                setDiscoveredPeerUids((prev) => (prev.includes(enrichedPeer.uid) ? prev : [...prev, enrichedPeer.uid]));
                return enrichedPeer;
            },
            [fetchAndCachePeer, walletPeers]
        );

        const updatePeers = useCallback(async (uids, { throttleMs = 0, refreshAvatar = false } = {}) => {
            const uniqueUids = Array.from(new Set((uids || []).filter(Boolean)));
            if (!uniqueUids.length) return [];

            const results = [];
            for (const uid of uniqueUids) {
                const result = await updatePeerByUID(uid, { refreshAvatar });
                if (result) results.push(result);
                if (throttleMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, throttleMs));
                }
            }

            if (results.length) {
                setPeerRefreshTick((tick) => tick + 1);
            }

            return results;
        }, []);

        const updatePeer = useCallback(
            async (uid, options = {}) => {
                const results = await updatePeers([uid], options);
                return results[0] ?? null;
            },
            [updatePeers]
        );

        const hiddenPeerUidsSet = useMemo(() => new Set(hiddenPeerUids), [hiddenPeerUids]);
        const allPeers = useMemo(() => {
            if (!profilesReady) return lastPeersRef.current;

            const next = assemblePeers(walletPeers, chatPeers, discoveredPeerUids);
            lastPeersRef.current = next;
            return next;
        }, [walletPeers, chatPeers, profilesReady, discoveredPeerUids, peerRefreshTick]);

        const blockedChatPKSet = useMemo(() => {
            const next = new Set();
            for (const peer of allPeers || []) {
                if (peer?.chatPK && blockedSet?.has?.(peer?.uid)) {
                    next.add(peer.chatPK);
                }
            }
            return next;
        }, [allPeers, blockedSet]);

        const isBlockedChatPK = useCallback(
            (chatPK) => {
                if (!chatPK) {
                    return false;
                }
                return blockedChatPKSet.has(chatPK);
            },
            [blockedChatPKSet]
        );

        const findPeer = useCallback(
            (peer) => {
                const uid = getPeerUid(peer);
                if (!uid) {
                    return null;
                }
                return (allPeers || []).find((item) => item?.uid === uid) || null;
            },
            [allPeers]
        );

        const enrichedPeers = useMemo(() => {
            const next = allPeers || [];
            const filtered = next.filter((peer) => !blockedSet?.has?.(peer?.uid) && !hiddenPeerUidsSet.has(peer?.uid));
            return filtered;
        }, [allPeers, blockedSet, hiddenPeerUidsSet]);

        useEffect(() => {
            if (!localCache || !profilesReady) {
                return;
            }

            const profiles = typeof getCachedProfiles === 'function' ? getCachedProfiles() : enrichedPeers;
            writeCachedProfiles(localCache, profiles);
        }, [enrichedPeers, getCachedProfiles, localCache, profilesReady]);

        const recentChatPeerChatPKs = useMemo(() => {
            if (!chatPK) return [];
            if (!Array.isArray(chats) || !chats.length) return [];

            const result = [];
            for (const chat of chats.slice(0, 15)) {
                const participants = Array.isArray(chat?.participants) ? chat.participants : [];
                const peer = participants.find((participant) => participant && participant !== chatPK);
                if (peer) result.push(peer);
            }
            return result;
        }, [chats, chatPK]);

        const chatPkToUid = useMemo(() => {
            const map = new Map();
            for (const peer of enrichedPeers || []) {
                if (peer?.chatPK && peer?.uid) {
                    map.set(peer.chatPK, peer.uid);
                }
            }
            return map;
        }, [enrichedPeers]);

        const recentChatPeerUids = useMemo(() => {
            const result = [];
            for (const peerChatPK of recentChatPeerChatPKs) {
                const uid = chatPkToUid.get(peerChatPK);
                if (uid) result.push(uid);
            }
            return result.slice(0, 15);
        }, [recentChatPeerChatPKs, chatPkToUid]);

        const recentChatPeerUidsKey = useMemo(() => recentChatPeerUids.join('|'), [recentChatPeerUids]);
        const refreshRunningRef = useRef(false);
        useEffect(() => {
            if (!profilesReady) return;
            if (!recentChatPeerUids.length) return;

            let cancelled = false;
            const run = async () => {
                if (refreshRunningRef.current) return;
                refreshRunningRef.current = true;
                try {
                    if (cancelled) return;
                    await updatePeers(recentChatPeerUids, { throttleMs: 120 });
                } finally {
                    refreshRunningRef.current = false;
                }
            };

            const timeoutId = setTimeout(() => {
                void run();
            }, 250);
            const intervalId = setInterval(() => {
                void run();
            }, 5 * 60000);

            return () => {
                cancelled = true;
                clearTimeout(timeoutId);
                clearInterval(intervalId);
            };
        }, [profilesReady, recentChatPeerUidsKey, updatePeers]);

        useEffect(() => {
            if (!blockedPeersReady) {
                return;
            }

            setBlockedPeers((prev) => prev.filter((peer) => blockedSet?.has?.(peer?.uid)));
        }, [blockedPeersReady, blockedSet]);

        const loadBlockedPeers = useCallback(async () => {
            if (!blockedReady) {
                return blockedPeersRef.current;
            }

            const blockedUids = Array.isArray(blocked) ? blocked.filter(Boolean) : [];
            if (!blockedUids.length) {
                setBlockedPeers([]);
                setBlockedPeersReady(true);
                return [];
            }

            const nextByUid = new Map(blockedPeersRef.current.filter((peer) => peer?.uid).map((peer) => [peer.uid, peer]));
            const missingUids = blockedUids.filter((uid) => !nextByUid.has(uid));

            if (missingUids.length) {
                const entries = await Promise.all(
                    missingUids.map(async (uid) => {
                        const peer = await fetchAndCachePeer({ uid });
                        return peer || null;
                    })
                );

                for (const peer of entries) {
                    if (peer?.uid) {
                        nextByUid.set(peer.uid, peer);
                    }
                }
            }

            const next = blockedUids.map((uid) => nextByUid.get(uid)).filter((peer) => peer?.uid);
            setBlockedPeers(next);
            setBlockedPeersReady(true);
            return next;
        }, [blocked, blockedReady, fetchAndCachePeer]);

        const dropPeer = useCallback((peer) => {
            const uid = getPeerUid(peer);
            if (!uid) {
                return;
            }
            setHiddenPeerUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
            setDiscoveredPeerUids((prev) => prev.filter((item) => item !== uid));
            if (typeof peer === 'object' && peer?.uid) {
                setBlockedPeers((prev) => [...prev.filter((item) => item?.uid !== uid), peer]);
            }
        }, []);

        const restorePeer = useCallback((peer) => {
            const uid = getPeerUid(peer);
            if (!uid) {
                return;
            }

            setHiddenPeerUids((prev) => prev.filter((item) => item !== uid));
            setBlockedPeers((prev) => prev.filter((item) => item?.uid !== uid));
            setDiscoveredPeerUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
        }, []);

        const value = useMemo(
            () => ({
                peers: enrichedPeers,
                blockedPeers,
                blockedPeersReady,
                blockedChatPKSet,
                isPeerDataReady: profilesReady,
                isBlockedChatPK,
                addPeer,
                primePeer,
                findPeer,
                updatePeer,
                dropPeer,
                restorePeer,
                loadBlockedPeers,
            }),
            [enrichedPeers, blockedPeers, blockedPeersReady, blockedChatPKSet, profilesReady, isBlockedChatPK, addPeer, primePeer, findPeer, updatePeer, dropPeer, restorePeer, loadBlockedPeers]
        );

        return <PeerContext value={value}>{children}</PeerContext>;
    }

    const usePeer = () => useContext(PeerContext);

    function usePeers() {
        const ctx = usePeer();
        if (!ctx) throw new Error('usePeers must be used within a PeerProvider');
        return ctx;
    }

    return { PeerProvider, usePeer, usePeers, PeerContext };
}
