'use client';

import Link from 'next/link';
import { useState } from 'react';
import { KeyRound, Loader, MessageCircleOff, Power, TriangleAlert, Wallet } from 'lucide-react';
import Loading from '@/components/loading';
import { Button } from '@/components/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Card } from '@/components/card';
import { useAdminData } from '@/components/providers/adminprovider';
import { botPowerClass, displayUser, formatSats } from '@/lib/admin/format';
import { toast } from 'sonner';

export default function BotPage() {
    const { bots, botsReady, powerBot, banUser, unbanUser } = useAdminData();
    const [pendingUid, setPendingUid] = useState('');
    const [banningKey, setBanningKey] = useState('');

    const handlePower = async (event, bot) => {
        event.preventDefault();
        event.stopPropagation();
        if (!bot?.uid || pendingUid === bot.uid) {
            return;
        }

        setPendingUid(bot.uid);
        try {
            await powerBot(bot.uid, !bot.enabled);
            toast(bot.enabled ? `paused ${displayUser(bot)}` : `enabled ${displayUser(bot)}`, { icon: <Power /> });
        } catch (error) {
            console.error('bot power update failed', error);
            toast(bot.enabled ? 'pause failed' : 'enable failed');
        } finally {
            setPendingUid('');
        }
    };

    const handleBan = async (event, bot, feature) => {
        event.preventDefault();
        event.stopPropagation();
        const key = `${bot?.uid || ''}:${feature}`;
        if (!bot?.uid || banningKey === key) {
            return;
        }

        const isBanned = feature === 'avatar' ? bot.avatarBanned : bot.chatBanned;
        setBanningKey(key);
        try {
            if (isBanned) {
                await unbanUser(bot.uid, feature);
                toast(`${feature} unbanned ${displayUser(bot)}`);
            } else {
                await banUser(bot.uid, feature);
                toast(`${feature} banned ${displayUser(bot)}`);
            }
        } catch (error) {
            console.error('bot ban update failed', error);
            toast(isBanned ? 'unban failed' : 'ban failed');
        } finally {
            setBanningKey('');
        }
    };

    const handleAvatarBan = (event, bot) => {
        if (banningKey === `${bot?.uid || ''}:avatar`) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        void handleBan(event, bot, 'avatar');
    };

    if (!botsReady) {
        return <Loading />;
    }

    if (botsReady && bots.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <Card className="w-full h-full">
                    <div className="flex h-full items-center justify-center px-4 py-2">
                        <p className="text-2xl text-muted">no bots provisioned</p>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="w-full h-full">
            <Card className="w-full h-full">
                <div className="h-full overflow-y-auto">
                    <div className={`divide-y ${bots.length < 12 ? 'border-b' : ''}`}>
                        {bots.map((bot) => (
                            <div key={bot.uid} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left">
                                <Link href={`/admin/bots/${bot.slug}`} className="group flex min-w-0 items-center gap-2.5 pr-4">
                                    <Avatar active={bot.active} bot={!!bot?.bot} className="grower">
                                        <AvatarImage src={bot.avatar} alt={displayUser(bot)} />
                                        <AvatarFallback />
                                    </Avatar>
                                    <div className="min-w-0">
                                        <p className="truncate">
                                            {bot.lastError ? <TriangleAlert className="mr-1 inline size-4 text-destructive" /> : null}
                                            <span className={bot.lastError ? 'text-destructive' : ''}>{displayUser(bot)}</span>
                                            <span className="text-muted"> · {bot.uid}</span>
                                        </p>
                                        <p className="truncate text-sm text-muted">
                                            <span>{bot.mode || 'mirror'}</span>
                                            {formatSats(bot.balance) ? <span> · {formatSats(bot.balance)}</span> : null}
                                        </p>
                                    </div>
                                </Link>
                                <div className="flex items-center gap-3">
                                    {bot.walletPK ? (
                                        <Button
                                            className="grower-lg px-2 py-2 text-muted"
                                            onClick={async (event) => {
                                                event.preventDefault();
                                                await navigator.clipboard.writeText(bot.walletPK);
                                                toast('wallet id copied', { icon: <Wallet /> });
                                            }}
                                            title="copy wallet id"
                                        >
                                            <Wallet className="size-5" />
                                        </Button>
                                    ) : null}
                                    {bot.chatPK ? (
                                        <Button
                                            className="grower-lg px-2 py-2 text-muted"
                                            onClick={async (event) => {
                                                event.preventDefault();
                                                await navigator.clipboard.writeText(bot.chatPK);
                                                toast('chat identity copied', { icon: <KeyRound /> });
                                            }}
                                            title="copy chat identity"
                                        >
                                            <KeyRound className="size-5" />
                                        </Button>
                                    ) : null}
                                    <Button
                                        className={`grower-lg px-2 py-2 ${bot.chatBanned ? 'text-destructive' : 'text-active'}`}
                                        onClick={(event) => handleBan(event, bot, 'chat')}
                                        disabled={banningKey === `${bot.uid}:chat`}
                                        title={bot.chatBanned ? 'unban chat' : 'ban chat'}
                                    >
                                        <MessageCircleOff className="size-5" />
                                    </Button>
                                    <Button
                                        className={`grower-lg size-10 p-0 ${bot.avatarBanned ? 'text-destructive' : 'text-active'}`}
                                        onClick={(event) => handleAvatarBan(event, bot)}
                                        disabled={banningKey === `${bot.uid}:avatar`}
                                        title={bot.avatarBanned ? 'unban avatar' : 'ban avatar'}
                                    >
                                        <Avatar className="pointer-events-none size-10">
                                            <AvatarFallback />
                                        </Avatar>
                                    </Button>
                                    <Button className={`grower-lg px-2 py-2 ${botPowerClass(bot)}`} onClick={(event) => handlePower(event, bot)} disabled={pendingUid === bot.uid} title={bot.enabled ? 'turn bot off' : 'turn bot on'}>
                                        {pendingUid === bot.uid ? <Loader className="size-5 animate-spin" /> : <Power className="size-5" />}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Card>
        </div>
    );
}
