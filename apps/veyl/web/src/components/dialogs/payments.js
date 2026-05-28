import { useState, useEffect, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/tabs';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import SendMoney from '@/components/sendmoney';
import RequestMoney from '@/components/requestmoney';
import { toDisplay } from '@/lib/utils';

function pickTab(tab, canSend) {
    const requested = tab || 'send';
    return requested === 'send' && canSend ? 'send' : 'request';
}

export default function Payments({ data, close }) {
    const bitcoin = useBitcoin();
    const { balance } = useWallet();
    const { settings, walletPK: currentUserWalletPK } = useUser();
    const canSend = balance != null && balance > 0;
    const peer = useMemo(() => (data?.peer?.walletPK === currentUserWalletPK ? null : data?.peer || null), [currentUserWalletPK, data?.peer]);
    const amount = useMemo(() => {
        if (data?.amount == null || data.amount === '') return '';
        return toDisplay(data.amount, settings.moneyFormat, bitcoin.price);
    }, [bitcoin.price, data?.amount, settings.moneyFormat]);
    const [activeTab, setActiveTab] = useState(() => pickTab(data?.tab, canSend));
    const [draftPeer, setDraftPeer] = useState(peer);
    const [draftAmount, setDraftAmount] = useState(amount);
    const [draftUnit, setDraftUnit] = useState(settings.moneyFormat);

    useEffect(() => {
        setActiveTab(pickTab(data?.tab, canSend));
    }, [data?.tab, canSend]);

    useEffect(() => {
        setDraftPeer(peer);
        setDraftAmount(amount);
        setDraftUnit(settings.moneyFormat);
    }, [amount, peer, settings.moneyFormat]);

    return (
        <div className="w-md flex max-w-full flex-col gap-2">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="send" disabled={!canSend}>
                        <ArrowUpRight className="size-6" />
                        send
                    </TabsTrigger>
                    <TabsTrigger value="request">
                        <ArrowDownLeft className="size-6" />
                        request
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="send" className="flex flex-col gap-2">
                    <SendMoney peer={draftPeer} amount={draftAmount} inputUnit={draftUnit} onPeerChange={setDraftPeer} onAmountChange={setDraftAmount} onInputUnitChange={setDraftUnit} />
                </TabsContent>
                <TabsContent value="request" className="flex flex-col gap-2">
                    <RequestMoney peer={draftPeer} amount={draftAmount} inputUnit={draftUnit} onPeerChange={setDraftPeer} onAmountChange={setDraftAmount} onInputUnitChange={setDraftUnit} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
