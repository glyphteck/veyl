'use client';

import { createPeerProvider } from '@glyphteck/shared/providers/peerprovider';
import { useChat } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useVault } from '@/components/providers/vaultprovider';
import * as peerApi from '@/lib/peers';

const { PeerProvider, usePeer, usePeers } = createPeerProvider({
    useChat,
    useUser,
    useTxData,
    useVault,
    peerApi,
});

export { PeerProvider, usePeer, usePeers };
