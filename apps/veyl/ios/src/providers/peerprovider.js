import { createPeerProvider } from '@glyphteck/shared/providers/peerprovider';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useVault } from '@/providers/vaultprovider';
import * as peerApi from '@/lib/peers';

const { PeerProvider, usePeer, usePeers } = createPeerProvider({
    useChat,
    useUser,
    useTxData,
    useVault,
    peerApi,
});

export { PeerProvider, usePeer, usePeers };
