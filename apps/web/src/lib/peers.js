'use client';

import { createPeersApi } from '@veyl/shared/peers';
import { createProfileQueries } from '@veyl/shared/search/remote';
import { resolveNetwork } from '@veyl/shared/network';
import { cloud } from '@/lib/cloud';

const peerApi = createPeersApi({
    cloud,
    network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
});

export const profileQueries = createProfileQueries({
    cloud,
    createProfileFromRecord: peerApi.createProfileFromRecord,
    cachePeer: peerApi.cachePeer,
});

export const {
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
} = peerApi;
