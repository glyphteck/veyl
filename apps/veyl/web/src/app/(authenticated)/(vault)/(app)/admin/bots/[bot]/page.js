'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Copy, KeyRound, Loader, MessageCircleOff, Power, Wallet } from 'lucide-react';
import Loading from '@/components/loading';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { useAdminData } from '@/components/providers/adminprovider';
import { formatUserDisplay } from '@/lib/utils';
import { toast } from 'sonner';

function displayBot(bot) {
    return bot?.username || bot?.uid || formatUserDisplay(bot);
}

function formatDateTime(value) {
    let date = null;

    if (typeof value?.toDate === 'function') {
        date = value.toDate();
    } else if (value instanceof Date) {
        date = value;
    } else if (typeof value === 'number') {
        date = new Date(value);
    } else if (typeof value?.seconds === 'number') {
        date = new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000));
    } else if (typeof value?._seconds === 'number') {
        date = new Date(value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000));
    } else if (typeof value === 'string') {
        date = new Date(value);
    }

    if (!date || Number.isNaN(date.getTime())) {
        return 'not yet';
    }

    return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
}

function powerButtonClass(bot) {
    if (!bot?.enabled) return 'text-destructive';
    if (bot?.active) return 'text-active';
    return 'text-pending';
}

function formatBalance(balance) {
    const n = Number(balance);
    if (!Number.isFinite(n)) {
        return null;
    }
    return `${n.toLocaleString()} sats`;
}

function MetaRow({ label, value, copyValue = '' }) {
    const text = value || 'not set';

    return (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-background/45 px-3 py-2">
            <p className="shrink-0 text-xs uppercase tracking-[0.12em] text-muted">{label}</p>
            <p className="min-w-0 truncate text-sm">{text}</p>
            {copyValue ? (
                <Button
                    className="grower-lg size-7 shrink-0 justify-center text-muted"
                    onClick={async () => {
                        await navigator.clipboard.writeText(copyValue);
                        toast(`${label} copied`, { icon: <Copy /> });
                    }}
                    title={`copy ${label}`}
                >
                    <Copy className="size-3.5" />
                </Button>
            ) : null}
        </div>
    );
}

export default function BotDetailPage() {
    const params = useParams();
    const slug = Array.isArray(params?.bot) ? params.bot[0] : params?.bot;
    const { botDetails, loadBot, powerBot, banUser, unbanUser } = useAdminData();
    const entry = slug ? botDetails[slug] : null;
    const bot = entry?.data?.bot || null;
    const [pendingPower, setPendingPower] = useState(false);
    const [banning, setBanning] = useState('');

    useEffect(() => {
        if (slug) {
            void loadBot(slug);
        }
    }, [loadBot, slug]);

    if (!entry || entry.loading) {
        return <Loading />;
    }

    if (entry.error === 'not-found' || !bot) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <Card className="w-full h-full">
                    <div className="flex h-full items-center justify-center px-4 py-2">
                        <p className="text-2xl text-muted">bot not found</p>
                    </div>
                </Card>
            </div>
        );
    }

    const handlePower = async () => {
        if (!bot?.uid || pendingPower) {
            return;
        }

        setPendingPower(true);
        try {
            await powerBot(bot.uid, !bot.enabled);
            toast(bot.enabled ? `paused ${displayBot(bot)}` : `enabled ${displayBot(bot)}`, { icon: <Power /> });
        } catch (error) {
            console.error('bot power update failed', error);
            toast(bot.enabled ? 'pause failed' : 'enable failed');
        } finally {
            setPendingPower(false);
        }
    };

    const copyUid = async () => {
        await navigator.clipboard.writeText(bot.uid);
        toast('account id copied', { icon: <Copy /> });
    };

    const handleBan = async (feature) => {
        if (!bot?.uid || banning) {
            return;
        }

        const isBanned = feature === 'avatar' ? bot.avatarBanned : bot.chatBanned;
        setBanning(feature);
        try {
            if (isBanned) {
                await unbanUser(bot.uid, feature);
                toast(`${feature} unbanned ${displayBot(bot)}`);
            } else {
                await banUser(bot.uid, feature);
                toast(`${feature} banned ${displayBot(bot)}`);
            }
        } catch (error) {
            console.error('bot ban update failed', error);
            toast(isBanned ? 'unban failed' : 'ban failed');
        } finally {
            setBanning('');
        }
    };

    return (
        <div className="w-full h-full">
            <Card className="w-full h-full">
                <div className="h-full overflow-y-auto">
                    <div className="divide-y border-b">
                        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-3">
                            <div className="flex min-w-0 items-center gap-2.5 pr-4">
                                <Button asChild className="grower-lg shrink-0">
                                    <Link href="/admin/bots">
                                        <ArrowLeft className="size-6" />
                                    </Link>
                                </Button>
                                <Avatar active={bot.active} bot={!!bot?.bot} className="size-10">
                                    <AvatarImage src={bot.avatar} alt={displayBot(bot)} />
                                    <AvatarFallback />
                                </Avatar>
                                <Button type="button" onClick={copyUid} className="h-auto min-w-0 justify-start rounded-none p-0 text-left">
                                    <p className="truncate">
                                        <span>{displayBot(bot)}</span>
                                        <span className="text-muted"> · {bot.uid}</span>
                                    </p>
                                    <p className="truncate text-sm text-muted">
                                        <span>{bot.mode || 'mirror'}</span>
                                        {formatBalance(bot.balance) ? <span> · {formatBalance(bot.balance)}</span> : null}
                                    </p>
                                </Button>
                            </div>
                            <div className="flex items-center gap-3">
                                {bot.walletPK ? (
                                    <Button
                                        className="grower-lg px-2 py-2 text-muted"
                                        onClick={async () => {
                                            await navigator.clipboard.writeText(bot.walletPK);
                                            toast('wallet id copied', { icon: <Wallet /> });
                                        }}
                                        title="copy wallet id"
                                    >
                                        <Wallet className="size-6" />
                                    </Button>
                                ) : null}
                                {bot.chatPK ? (
                                    <Button
                                        className="grower-lg px-2 py-2 text-muted"
                                        onClick={async () => {
                                            await navigator.clipboard.writeText(bot.chatPK);
                                            toast('chat identity copied', { icon: <KeyRound /> });
                                        }}
                                        title="copy chat identity"
                                    >
                                        <KeyRound className="size-6" />
                                    </Button>
                                ) : null}
                                <Button
                                    className={`grower-lg px-2 py-2 ${bot.chatBanned ? 'text-destructive' : 'text-active'}`}
                                    onClick={() => handleBan('chat')}
                                    disabled={banning === 'chat'}
                                    title={bot.chatBanned ? 'unban chat' : 'ban chat'}
                                >
                                    <MessageCircleOff className="size-6" />
                                </Button>
                                <Button
                                    className={`grower-lg size-10 p-0 ${bot.avatarBanned ? 'text-destructive' : 'text-active'}`}
                                    onClick={() => handleBan('avatar')}
                                    disabled={banning === 'avatar'}
                                    title={bot.avatarBanned ? 'unban avatar' : 'ban avatar'}
                                >
                                    <Avatar className="pointer-events-none size-10">
                                        <AvatarFallback />
                                    </Avatar>
                                </Button>
                                <Button className={`grower-lg px-2 py-2 ${powerButtonClass(bot)}`} onClick={handlePower} disabled={pendingPower} title={bot.enabled ? 'turn bot off' : 'turn bot on'}>
                                    {pendingPower ? <Loader className="size-6 animate-spin" /> : <Power className="size-6" />}
                                </Button>
                            </div>
                        </div>
                        <section className="space-y-2 px-3 py-3">
                            <div className="grid gap-1.5">
                                <MetaRow label="resume at" value={formatDateTime(bot.resumeAt)} />
                                <MetaRow label="last boot" value={formatDateTime(bot.lastBootAt)} />
                                <MetaRow label="last run" value={formatDateTime(bot.lastRunAt)} />
                                <MetaRow label="last error" value={bot.lastError || 'clear'} copyValue={bot.lastError || ''} />
                            </div>
                        </section>
                    </div>
                </div>
            </Card>
        </div>
    );
}
