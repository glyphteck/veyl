import { useEffect, useRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { readResumeTarget } from '@veyl/shared/cache/localdata';
import { hrefForResumeTarget } from '@veyl/shared/navigation/resume';
import { qr, readQr } from '@veyl/shared/qr';
import { isAddressOnNetwork } from '@veyl/shared/network';

import { useChat } from '@/providers/chatprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { useWallet } from '@/providers/walletprovider';
import { isInvoiceScanSuppressed } from '@/lib/invoicescan';
import { dropPendingInvite } from '@/lib/invite';
import { writePendingQrIntent } from '@/lib/qrintent';

export default function QRRoute() {
    const params = useLocalSearchParams();
    const { selectPeerChat } = useChat() || {};
    const { addPeer } = usePeer() || {};
    const { chatBanned, chatPK, walletPK: ownWalletPK } = useUser();
    const { localCache } = useVault();
    const { network } = useWallet();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        const data = readQr(params);

        async function run() {
            await dropPendingInvite();
            const resumeHref = hrefForResumeTarget(readResumeTarget(localCache));

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
                    await writePendingQrIntent(data);
                    router.replace(resumeHref);
                    return;
                }
            }

            if (data?.kind === qr.lightning || data?.kind === qr.spark) {
                if (isInvoiceScanSuppressed({ type: data.kind, invoice: data.invoice })) {
                    router.replace(resumeHref);
                    return;
                }

                await writePendingQrIntent(data);
                router.replace(resumeHref);
                return;
            }

            if (data?.kind === qr.bitcoin && data.address && isAddressOnNetwork(data.address, network)) {
                await writePendingQrIntent(data);
                router.replace(resumeHref);
                return;
            }

            router.replace(resumeHref);
        }

        run().catch((error) => {
            console.warn('qr route failed', error);
            router.replace('/wallet');
        });
    }, [addPeer, chatBanned, chatPK, localCache, network, ownWalletPK, params, selectPeerChat]);

    return null;
}
