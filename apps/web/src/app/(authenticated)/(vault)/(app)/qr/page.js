'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/notifications';
import { Coins, Loader } from 'lucide-react';
import Loading from '@/components/loading';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useChat } from '@/components/providers/chatprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { formatUserDisplay } from '@veyl/shared/profile';
import { renderMoney } from '@veyl/shared/money';
import { qr, readQr } from '@veyl/shared/qr';
import { isAddressOnNetwork } from '@veyl/shared/network';
import { canSendOnScan } from '@veyl/shared/settings';

export default function QRPage() {
    const router = useRouter();
    const handledRef = useRef(false);
    const { openDialog } = useDialog();
    const { selectPeerChat } = useChat();
    const { addPeer } = usePeer();
    const { chatBanned, chatPK, settings, username, walletPK: ownWalletPK } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, network } = useWallet();
    const { cloaked } = useCloak();

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        const data = readQr(window.location.href);

        async function run() {
            if (data?.kind === qr.user && data.username) {
                if (data.username !== username) {
                    const peer = await addPeer({ username: data.username });
                    if (peer?.chatPK && !chatBanned && chatPK) {
                        await selectPeerChat(peer.chatPK);
                        router.replace('/chat');
                        return;
                    }
                    toast.error('user not found');
                }
                router.replace('/wallet');
                return;
            }

            if (data?.kind === qr.request && data.to) {
                if (data.to !== ownWalletPK) {
                    const peer = await addPeer({ walletPK: data.to });
                    if (peer) {
                        if (canSendOnScan(settings) && data.amount) {
                            const displayName = formatUserDisplay(peer, false);
                            const formattedAmount = renderMoney(data.amount.toString(), settings.moneyFormat, bitcoin.price);
                            const loadingToastId = toast(cloaked ? `sending money to ${displayName}` : `sending ${formattedAmount} to ${displayName}`, {
                                icon: <Loader className="animate-spin" />,
                                duration: Infinity,
                            });
                            try {
                                await sendMoneyWithSpark(peer.walletPK, data.amount.toString());
                                toast.success(cloaked ? `sent money to ${displayName}` : `sent ${formattedAmount} to ${displayName}`, {
                                    id: loadingToastId,
                                    icon: <Coins />,
                                    duration: 2000,
                                });
                            } catch (error) {
                                toast.error(error.message || 'failed to send money', {
                                    id: loadingToastId,
                                    duration: 2000,
                                });
                            }
                        } else {
                            openDialog('payments', { peer, tab: 'send', amount: data.amount ?? null });
                        }
                    } else {
                        toast.error('user not found');
                    }
                }
                router.replace('/wallet');
                return;
            }

            if (data?.kind === qr.lightning || data?.kind === qr.spark) {
                openDialog('payments', {
                    tab: 'send',
                    invoice: data,
                    amount: data.amount ?? null,
                });
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
    }, [addPeer, bitcoin, chatBanned, chatPK, cloaked, network, openDialog, ownWalletPK, router, selectPeerChat, sendMoneyWithSpark, settings, username]);

    return <Loading />;
}
