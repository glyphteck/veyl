import { useEffect, useMemo } from 'react';
import { createPeerProvider } from '@veyl/shared/providers/peerprovider';
import { sortedUniqueValues } from '@veyl/shared/utils/array';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useVault } from '@/providers/vaultprovider';
import * as peerApi from '@/lib/peers';
import { prefetchAvatarImages } from '@/lib/user/avatarimages';

const { PeerProvider: BasePeerProvider, usePeer, usePeers } = createPeerProvider({
    useChat,
    useUser,
    useTxData,
    useVault,
    peerApi,
});

function PeerAvatarPrefetch() {
    const { peers } = usePeer() || {};
    const avatarUrls = useMemo(() => {
        const urls = [];
        for (const peer of Array.isArray(peers) ? peers : []) {
            if (typeof peer?.avatar === 'string' && peer.avatar) {
                urls.push(peer.avatar);
            }
        }
        return sortedUniqueValues(urls);
    }, [peers]);

    useEffect(() => {
        prefetchAvatarImages(avatarUrls);
    }, [avatarUrls]);

    return null;
}

function PeerProvider({ children }) {
    return (
        <BasePeerProvider>
            <PeerAvatarPrefetch />
            {children}
        </BasePeerProvider>
    );
}

export { PeerProvider, usePeer, usePeers };
