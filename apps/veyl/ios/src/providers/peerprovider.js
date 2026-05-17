import { useEffect, useMemo } from 'react';
import { createPeerProvider } from '@glyphteck/shared/providers/peerprovider';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useVault } from '@/providers/vaultprovider';
import * as peerApi from '@/lib/peers';
import { prefetchAvatarImages } from '@/lib/avatarimagecache';

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
        return Array.from(new Set(urls)).sort();
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
