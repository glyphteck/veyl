'use client';

import { createPeersApi } from '@glyphteck/shared/peers';
import { createProfileQueries } from '@glyphteck/shared/search/remote';
import { resolveNetwork } from '@glyphteck/shared/network';
import { db, getStorage } from '@/lib/firebase/firebaseclient';

const peerApi = createPeersApi({
    db,
    getStorage,
    network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
});

export const profileQueries = createProfileQueries({
    db,
    createProfileFromDoc: peerApi.createProfileFromDoc,
    cachePeer: peerApi.cachePeer,
});

export const {
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
} = peerApi;
