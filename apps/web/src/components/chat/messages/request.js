'use client';

import { Button } from '@/components/button';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { Loader } from 'lucide-react';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { bubbleBg, stopClick } from '@/lib/chat/messages';
import { getRequestContext } from '@veyl/shared/chat/messages';

export default function RequestMessage({ msg, fromPeer = false, peerDisplayName, onPay, isPaying = false }) {
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { balance } = useWallet();
    const { getTxById } = useTxData();
    const { openDialog } = useDialog();
    const { cloaked } = useCloak();
    const { amount: formattedAmount, label, tx: msgTx } = getRequestContext(msg, { fromPeer, peerDisplayName, moneyFormat: settings?.moneyFormat, btcPrice: bitcoin?.price, getTxById });
    const isTransactionPending = msg.tx && (!msgTx || msgTx.pending !== false);
    const handleClick = msg.tx
        ? (event) => {
              event.stopPropagation();
              if (msgTx) openDialog('txdetails', { tx: msgTx });
          }
        : stopClick;

    if (fromPeer) {
        const canAfford = balance != null && Number(msg.a) <= balance;

        return (
            <div className={`backdrop-blur-sm max-w-full shadow rounded-round p-3 ${bubbleBg(fromPeer)} ${msg.tx ? 'grower-sm' : ''}`} onClick={handleClick}>
                <div className="flex flex-col w-full">
                    <p className="break-words text-muted">{label}</p>
                    <p className={`text-6xl font-black ${msg.tx ? (isTransactionPending ? 'text-outflow opacity-50' : 'text-outflow') : ''} ${cloaked ? 'cloaked' : ''}`}>{formattedAmount}</p>
                    {!msg.tx ? (
                        <Button className="button-fill shrinker mt-2 mb-1 w-full" disabled={!canAfford || isPaying} onClick={() => onPay?.()}>
                            {isPaying ? <Loader className="animate-spin size-6" /> : 'send'}
                        </Button>
                    ) : null}
                </div>
            </div>
        );
    }

    return (
        <div className={`backdrop-blur-sm max-w-full shadow rounded-round p-3 ${bubbleBg(fromPeer)} ${msg.tx ? 'grower-sm' : ''}`} onClick={handleClick}>
            <div className="flex flex-col gap-2 w-full">
                <div className="flex flex-col items-end">
                    <p className="break-words text-muted text-right">{label}</p>
                    <p className={`text-6xl font-black ${msg.tx ? (isTransactionPending ? 'text-inflow opacity-50' : 'text-inflow') : ''} ${cloaked ? 'cloaked' : ''}`}>{formattedAmount}</p>
                </div>
            </div>
        </div>
    );
}
