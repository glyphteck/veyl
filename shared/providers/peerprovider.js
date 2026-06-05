'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    RECENT_PEER_REFRESH_DELAY_MS,
    RECENT_PEER_REFRESH_INTERVAL_MS,
    RECENT_PEER_REFRESH_LIMIT,
    RECENT_PEER_REFRESH_THROTTLE_MS,
} from '../config.js';
import { sortedUniqueValues, uniqueValues } from '../utils/array.js';
import { sleep } from '../utils/async.js';
import { readCachedProfiles, writeCachedProfiles } from '../cache/localdata.js';
import { peerUid } from '../profile.js';
import { getChatPeerPK } from '../chat/ids.js';
import { compareProfilesByName } from '../search/sort.js';
import { timestampMs } from '../utils/time.js';

function byRecent(a, b) {
    const delta = (b?.recentAt || 0) - (a?.recentAt || 0);
    if (delta !== 0) return delta;
    return compareProfilesByName(a, b);
}

function makeRecentPeer(peer, recency) {
    return {
        ...peer,
        recentAt: recency?.all || 0,
        recent: {
            wallet: recency?.wallet ?? 0,
            chat: recency?.chat ?? 0,
        },
    };
}

export function createPeerProvider({ useChat, useUser, useTxData, useVault, peerApi }) {
    if (typeof useChat !== 'function' || typeof useUser !== 'function' || typeof useTxData !== 'function' || typeof useVault !== 'function') {
        throw new Error('createPeerProvider requires { useChat, useUser, useTxData, useVault, peerApi }');
    }
    if (!peerApi) {
        throw new Error('createPeerProvider requires peerApi');
    }

    const { loadProfiles, assemblePeers, fetchAndCachePeer, updatePeerByUID, hydrateProfiles, getCachedProfiles } = peerApi;
    const PeerContext = createContext(null);

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
        const walletPKs = useMemo(() => sortedUniqueValues(Object.keys(walletPeers || {})), [walletPeers]);
        const chatPeerPKs = useMemo(() => sortedUniqueValues(chatPeers), [chatPeers]);

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

            const newWalletPKs = walletPKs.filter((key) => !seenWalletPKs.has(key));
            const newChatPKs = chatPeerPKs.filter((key) => !seenChatPKs.has(key));

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
        }, [chatPeerPKs, loadProfiles, walletPKs]);

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

        const updatePeers = useCallback(async (uids, { throttleMs = 0 } = {}) => {
            const uniqueUids = uniqueValues(uids);
            if (!uniqueUids.length) return [];

            const results = [];
            for (const uid of uniqueUids) {
                const result = await updatePeerByUID(uid);
                if (result) results.push(result);
                if (throttleMs > 0) {
                    await sleep(throttleMs);
                }
            }

            if (results.length) {
                setPeerRefreshTick((tick) => tick + 1);
            }

            return results;
        }, []);

        const updatePeer = useCallback(
            async (uid) => {
                const results = await updatePeers([uid]);
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

        const enrichedPeers = useMemo(() => {
            const next = allPeers || [];
            const filtered = next.filter((peer) => !blockedSet?.has?.(peer?.uid) && !hiddenPeerUidsSet.has(peer?.uid));
            return filtered;
        }, [allPeers, blockedSet, hiddenPeerUidsSet]);

        const allPeerByUid = useMemo(() => {
            const map = new Map();
            for (const peer of allPeers || []) {
                if (peer?.uid) {
                    map.set(peer.uid, peer);
                }
            }
            return map;
        }, [allPeers]);

        const peerIndexes = useMemo(() => {
            const byUid = new Map();
            const byWalletPK = new Map();
            const byChatPK = new Map();
            const byUsername = new Map();
            for (const peer of enrichedPeers || []) {
                if (peer?.uid) byUid.set(peer.uid, peer);
                if (peer?.walletPK) byWalletPK.set(peer.walletPK, peer);
                if (peer?.chatPK) byChatPK.set(peer.chatPK, peer);
                if (peer?.username) byUsername.set(peer.username, peer);
            }
            return { byUid, byWalletPK, byChatPK, byUsername };
        }, [enrichedPeers]);
        const peerByUid = peerIndexes.byUid;
        const peerByWalletPK = peerIndexes.byWalletPK;
        const peerByChatPK = peerIndexes.byChatPK;
        const peerByUsername = peerIndexes.byUsername;

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
                    const uid = peerUid(peer);
                if (!uid) {
                    return null;
                }
                return allPeerByUid.get(uid) || null;
            },
            [allPeerByUid]
        );

        useEffect(() => {
            if (!localCache || !profilesReady) {
                return;
            }

            const profiles = typeof getCachedProfiles === 'function' ? getCachedProfiles() : enrichedPeers;
            writeCachedProfiles(localCache, profiles);
        }, [enrichedPeers, getCachedProfiles, localCache, profilesReady]);

        const recentPeers = useMemo(() => {
            const recencyByUid = new Map();
            const setRecent = (uid, kind, ms) => {
                if (!uid || ms == null) return;
                const recency = recencyByUid.get(uid) || { wallet: null, chat: null, all: 0 };
                recency[kind] = Math.max(recency[kind] ?? 0, ms || 0);
                recency.all = Math.max(recency.all || 0, recency[kind] || 0);
                recencyByUid.set(uid, recency);
            };

            for (const peer of peerByUid.values()) {
                const walletPeer = peer?.walletPK ? walletPeers?.[peer.walletPK] : null;
                const ms = timestampMs(walletPeer?.lastMs, null, { parseString: true });
                if (walletPeer) {
                    setRecent(peer.uid, 'wallet', ms || 0);
                }
            }

            for (const chat of chats || []) {
                const peerChatPK = getChatPeerPK(chat, chatPK);
                const uid = peerChatPK ? peerByChatPK.get(peerChatPK)?.uid : null;
                const ms = timestampMs(chat?.ts, null, { parseString: true }) ?? 0;
                if (uid) {
                    setRecent(uid, 'chat', ms);
                }
            }

            const all = [];
            const wallet = [];
            const chat = [];
            for (const [uid, recency] of recencyByUid.entries()) {
                const peer = peerByUid.get(uid);
                if (!peer) continue;
                const recentPeer = makeRecentPeer(peer, recency);
                all.push(recentPeer);
                if (recency.wallet != null && recency.wallet >= 0 && peer.walletPK) wallet.push(recentPeer);
                if (recency.chat != null && recency.chat >= 0 && peer.chatPK) chat.push(recentPeer);
            }

            all.sort(byRecent);
            wallet.sort((a, b) => {
                const delta = (b?.recent?.wallet || 0) - (a?.recent?.wallet || 0);
                return delta !== 0 ? delta : byRecent(a, b);
            });
            chat.sort((a, b) => {
                const delta = (b?.recent?.chat || 0) - (a?.recent?.chat || 0);
                return delta !== 0 ? delta : byRecent(a, b);
            });

            return { all, wallet, chat };
        }, [chatPK, chats, peerByChatPK, peerByUid, walletPeers]);

        const recentPeerUids = useMemo(() => recentPeers.all.map((peer) => peer.uid).filter(Boolean).slice(0, RECENT_PEER_REFRESH_LIMIT), [recentPeers]);
        const recentPeerRefreshUidsKey = useMemo(() => sortedUniqueValues(recentPeerUids).join('|'), [recentPeerUids]);
        const refreshRunningRef = useRef(false);
        useEffect(() => {
            if (!profilesReady) return;
            if (!recentPeerRefreshUidsKey) return;
            const refreshUids = recentPeerRefreshUidsKey.split('|');

            let cancelled = false;
            const run = async () => {
                if (refreshRunningRef.current) return;
                refreshRunningRef.current = true;
                try {
                    if (cancelled) return;
                    await updatePeers(refreshUids, { throttleMs: RECENT_PEER_REFRESH_THROTTLE_MS });
                } finally {
                    refreshRunningRef.current = false;
                }
            };

            const timeoutId = setTimeout(() => {
                void run();
            }, RECENT_PEER_REFRESH_DELAY_MS);
            const intervalId = setInterval(() => {
                void run();
            }, RECENT_PEER_REFRESH_INTERVAL_MS);

            return () => {
                cancelled = true;
                clearTimeout(timeoutId);
                clearInterval(intervalId);
            };
        }, [profilesReady, recentPeerRefreshUidsKey, updatePeers]);

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
            const uid = peerUid(peer);
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
            const uid = peerUid(peer);
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
                recentPeers,
                peerByUid,
                peerByWalletPK,
                peerByChatPK,
                peerByUsername,
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
            [
                enrichedPeers,
                recentPeers,
                peerByUid,
                peerByWalletPK,
                peerByChatPK,
                peerByUsername,
                blockedPeers,
                blockedPeersReady,
                blockedChatPKSet,
                profilesReady,
                isBlockedChatPK,
                addPeer,
                primePeer,
                findPeer,
                updatePeer,
                dropPeer,
                restorePeer,
                loadBlockedPeers,
            ]
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
