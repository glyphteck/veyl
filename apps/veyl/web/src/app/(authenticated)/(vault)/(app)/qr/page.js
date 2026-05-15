'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Loading from '@/components/loading';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { qr, readQr } from '@glyphteck/shared/qrutils';
import { isAddressOnNetwork } from '@glyphteck/shared/network';

export default function QRPage() {
    const router = useRouter();
    const handledRef = useRef(false);
    const { openDialog } = useDialog();
    const { addPeer } = usePeer();
    const { username, walletPK: ownWalletPK } = useUser();
    const { network } = useWallet();

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        const data = readQr(window.location.href);

        async function run() {
            if (data?.kind === qr.user && data.username) {
                if (data.username !== username) {
                    const peer = await addPeer({ username: data.username });
                    if (peer) openDialog('payments', { peer, tab: 'send' });
                    else toast.error('user not found');
                }
                router.replace('/wallet');
                return;
            }

            if (data?.kind === qr.request && data.to) {
                if (data.to !== ownWalletPK) {
                    const peer = await addPeer({ walletPK: data.to });
                    if (peer) openDialog('payments', { peer, tab: 'send', amount: data.amount ?? null });
                    else toast.error('user not found');
                }
                router.replace('/wallet');
                return;
            }

            if (data?.kind === qr.bitcoin && data.address) {
                if (isAddressOnNetwork(data.address, network)) {
                    openDialog('withdraw', { address: data.address });
                } else {
                    toast.error(`wrong network - not a ${network.toLowerCase()} address`);
                }
                router.replace('/wallet');
                return;
            }

            router.replace('/wallet');
        }

        run().catch((error) => {
            console.error('QR route failed:', error);
            router.replace('/wallet');
        });
    }, [addPeer, network, openDialog, ownWalletPK, router, username]);

    return <Loading />;
}
