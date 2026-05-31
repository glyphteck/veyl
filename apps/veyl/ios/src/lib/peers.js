import { createPeersApi } from '@veyl/shared/peers';
import { createProfileQueries } from '@veyl/shared/search/remote';
import { resolveNetwork } from '@veyl/shared/network';
import { db, storage } from '@/lib/firebase';

const peerApi = createPeersApi({
    db,
    storage,
    network: resolveNetwork(globalThis?.process?.env ?? {}),
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
