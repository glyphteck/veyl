import { useEffect, useRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { qr, readQr } from '@glyphteck/shared/qrutils';
import { isAddressOnNetwork } from '@glyphteck/shared/network';
import { getChatId } from '@glyphteck/shared/crypto/chat';

import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';

export default function QRRoute() {
    const params = useLocalSearchParams();
    const { selectChat } = useChat() || {};
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
                    const chatId = getChatId(chatPK, peer.chatPK);
                    selectChat?.(chatId);
                    router.replace({
                        pathname: '/currentchat',
                        params: {
                            id: chatId,
                        },
                    });
                    return;
                }
            }

            if (data?.kind === qr.request && data.to) {
                if (data.to !== ownWalletPK) {
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
                            ...(data.amount ? { amount: data.amount, send: '1', auto: settings?.sendOnScan ? '1' : '0' } : { send: '1' }),
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
    }, [addPeer, chatBanned, chatPK, network, ownWalletPK, params, selectChat, settings?.sendOnScan]);

    return null;
}
