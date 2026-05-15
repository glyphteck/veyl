import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/tabs';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import SendMoney from '@/components/sendmoney';
import RequestMoney from '@/components/requestmoney';

function pickTab(tab, hasBalance) {
    let next = tab || (hasBalance ? 'send' : 'request');
    if (next === 'send' && !hasBalance) next = 'request';
    return next;
}

export default function Payments({ data, close }) {
    const { balance } = useWallet();
    const { walletPK: currentUserWalletPK } = useUser();
    const hasBalance = balance && balance > 0;
    const peer = data?.peer?.walletPK === currentUserWalletPK ? null : data?.peer;
    const amount = data?.amount;
    const [activeTab, setActiveTab] = useState(() => pickTab(data?.tab, hasBalance));

    useEffect(() => {
        setActiveTab(pickTab(data?.tab, hasBalance));
    }, [data?.tab, hasBalance]);

    return (
        <div className="w-lg flex flex-col gap-2">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="send" disabled={!hasBalance}>
                        <ArrowUpRight className="size-6" />
                        send
                    </TabsTrigger>
                    <TabsTrigger value="request">
                        <ArrowDownLeft className="size-6" />
                        request
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="send" className="flex flex-col gap-2">
                    <SendMoney peer={peer} amount={amount} />
                </TabsContent>
                <TabsContent value="request" className="flex flex-col gap-2">
                    <RequestMoney peer={peer} amount={amount} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
