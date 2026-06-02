import { useEffect, useRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { qr, readQr } from '@veyl/shared/qr';
import { isAddressOnNetwork } from '@veyl/shared/network';
import { canSendOnScan } from '@veyl/shared/settings';

import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';

export default function QRRoute() {
    const params = useLocalSearchParams();
    const { selectPeerChat } = useChat() || {};
    const { addPeer } = usePeer() || {};
    const { chatBanned, chatPK, settings, walletPK: ownWalletPK } = useUser();
    const { network } = useWallet();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        const data = readQr(params);

        async function run() {
            if (data?.kind === qr.user && data.username) {
                const peer = await addPeer?.({ username: data.username });
                if (!chatBanned && chatPK && peer?.chatPK) {
                    await selectPeerChat?.(peer.chatPK);
                    router.replace({
                        pathname: '/chat/[peerchatpk]',
                        params: {
                            peerchatpk: peer.chatPK,
                        },
                    });
                    return;
                }
            }

            if (data?.kind === qr.request && data.to) {
                if (data.to !== ownWalletPK) {
                    const auto = canSendOnScan(settings) && !!data.amount;
                    let peer = null;
                    try {
                        peer = await addPeer?.({ walletPK: data.to });
                    } catch (error) {
                        console.warn('qr peer lookup failed', error);
                    }

                    router.replace({
                        pathname: '/transfer',
                        params: {
                            uid: peer?.uid ?? '',
                            walletPK: peer?.walletPK ?? data.to,
                            ...(data.amount ? { amount: data.amount, send: '1', auto: auto ? '1' : '0' } : { send: '1' }),
                        },
                    });
                    return;
                }
            }

            if (data?.kind === qr.bitcoin && data.address && isAddressOnNetwork(data.address, network)) {
                router.replace({ pathname: '/withdraw', params: { address: data.address } });
                return;
            }

            router.replace('/wallet');
        }

        run().catch((error) => {
            console.warn('qr route failed', error);
            router.replace('/wallet');
        });
    }, [addPeer, chatBanned, chatPK, network, ownWalletPK, params, selectPeerChat, settings?.sendOnScan]);

    return null;
}
