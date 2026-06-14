'use client';

import { Card } from '@/components/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { formatUserDisplay } from '@veyl/shared/profile';
import { renderMoney } from '@veyl/shared/money';
import { formatFullDateTime } from '@veyl/shared/utils/time';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useUser } from '@/components/providers/userprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { Clock, HandCoins, Check, Copy, BanknoteArrowDown, BanknoteArrowUp } from 'lucide-react';
import { toast } from '@/components/notifications';

export default function TxDetails({ data, close }) {
    const bitcoin = useBitcoin();
    const user = useUser();
    const { peerByWalletPK } = usePeer();
    const { openDialog } = useDialog();
    const { cloaked } = useCloak();
    const { settings } = user;
    const moneyFormat = settings.moneyFormat;
    const tx = data?.tx;
    if (!tx) return null;

    const hasAccepted = !tx.pending && tx.updatedTime !== tx.createdTime;
    const peerProfile = tx.peerPK ? peerByWalletPK.get(tx.peerPK) : null;

    const getSenderInfo = () => {
        if (tx.funding) {
            return { username: 'External', avatar: null, walletPK: null };
        }
        if (tx.incoming) {
            return { ...peerProfile, walletPK: tx.peerPK };
        }
        return { uid: user?.uid, username: user?.username, avatar: user?.avatar, walletPK: null, active: user?.active };
    };
    const getReceiverInfo = () => {
        if (tx.funding) {
            return { uid: user?.uid, username: user?.username, avatar: user?.avatar, walletPK: null, active: user?.active };
        }
        if (tx.incoming) {
            return { uid: user?.uid, username: user?.username, avatar: user?.avatar, walletPK: null, active: user?.active };
        }
        return { ...peerProfile, walletPK: tx.peerPK };
    };

    const senderInfo = getSenderInfo();
    const receiverInfo = getReceiverInfo();
    const handleUserClick = (userInfo) => {
        if (userInfo.username !== 'External') {
            openDialog(userInfo?.uid && userInfo.uid === user?.uid ? 'settings' : 'userdetails', userInfo?.uid && userInfo.uid === user?.uid ? null : { user: userInfo });
        }
    };

    const copyTxDetails = (e) => {
        if (tx.id) {
            navigator.clipboard.writeText(tx.id);
            toast('transaction ID copied to clipboard', {
                ...(cloaked ? { icon: <Copy /> } : { description: tx.id, icon: <Copy /> }),
            });
            if (e.ctrlKey || e.metaKey) {
                const network = process.env.NEXT_PUBLIC_NETWORK === 'REGTEST' ? 'regtest' : 'mainnet';
                const sparkscanUrl = `https://www.sparkscan.io/tx/${tx.id}?network=${network}`;
                window.open(sparkscanUrl, '_blank');
            }
        }
    };

    return (
        <Card className="w-lg bg-background/70 shadow pt-1.5">
            {tx.funding ? (
                <div className="flex w-full items-center justify-between px-4 pt-2">
                    <Button className="pointer-events-none group" onClick={() => handleUserClick(receiverInfo)}>
                        <Avatar active={receiverInfo?.active} bot={!!receiverInfo?.bot} className="pointer-events-auto grower">
                            <AvatarImage src={receiverInfo.avatar} />
                            <AvatarFallback />
                        </Avatar>
                        <span className="text-lg truncate pointer-events-auto">{formatUserDisplay(receiverInfo, true)}</span>
                    </Button>
                    <Button className="grower-lg" onClick={copyTxDetails}>
                        <BanknoteArrowDown className="size-6" />
                    </Button>
                </div>
            ) : tx.withdrawal ? (
                <div className="flex w-full items-center justify-between px-4 pt-2">
                    <Button className="pointer-events-none group" onClick={() => handleUserClick(senderInfo)}>
                        <Avatar active={senderInfo?.active} bot={!!senderInfo?.bot} className="pointer-events-auto grower">
                            <AvatarImage src={senderInfo.avatar} />
                            <AvatarFallback />
                        </Avatar>
                        <span className="text-lg truncate pointer-events-auto">{formatUserDisplay(senderInfo, true)}</span>
                    </Button>
                    <Button className="grower-lg" onClick={copyTxDetails}>
                        <BanknoteArrowUp className="size-6" />
                    </Button>
                </div>
            ) : (
                <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-8 px-4 pt-2">
                    <Button className="pointer-events-none min-w-0 justify-start group" onClick={() => handleUserClick(senderInfo)}>
                        <Avatar active={senderInfo?.active} bot={!!senderInfo?.bot} className="pointer-events-auto shrink-0 grower">
                            <AvatarImage src={senderInfo.avatar} />
                            <AvatarFallback />
                        </Avatar>
                        <span className="text-lg truncate pointer-events-auto min-w-0">{formatUserDisplay(senderInfo, true)}</span>
                    </Button>
                    <Button className="grower-lg" onClick={copyTxDetails}>
                        <HandCoins className="size-7" />
                    </Button>
                    <Button className="pointer-events-none min-w-0 justify-end group" onClick={() => handleUserClick(receiverInfo)}>
                        <Avatar active={receiverInfo?.active} bot={!!receiverInfo?.bot} className="pointer-events-auto shrink-0 grower">
                            <AvatarImage src={receiverInfo.avatar} />
                            <AvatarFallback />
                        </Avatar>
                        <span className="text-lg truncate pointer-events-auto min-w-0">{formatUserDisplay(receiverInfo, true)}</span>
                    </Button>
                </div>
            )}
            <div className={`${tx.funding || tx.incoming ? 'text-inflow' : 'text-outflow'} flex justify-center px-4 py-8 text-5xl font-black ${tx.pending ? 'opacity-50' : ''} ${cloaked ? 'cloaked' : ''}`}>
                {renderMoney(tx.totalValue, moneyFormat, bitcoin.price, tx.funding || tx.incoming ? '+' : '-')}
            </div>
            <div className="flex w-full flex-col gap-3 px-4 pb-2">
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                        {tx.pending ? (
                            <>
                                <Clock />
                                <span>pending</span>
                            </>
                        ) : (
                            <>
                                <Check />
                                <span>confirmed</span>
                            </>
                        )}
                    </div>
                    <div className="relative group">
                        <span className="block group-hover:hidden">
                            <span className="text-muted italic">{hasAccepted ? 'accepted at ' : 'sent at '}</span>
                            {hasAccepted ? formatFullDateTime(tx.updatedTime) : formatFullDateTime(tx.createdTime)}
                        </span>
                        <span className="hidden group-hover:block">
                            <span className="text-muted italic">sent at </span>
                            {formatFullDateTime(tx.createdTime)}
                        </span>
                    </div>
                </div>
            </div>
        </Card>
    );
}
