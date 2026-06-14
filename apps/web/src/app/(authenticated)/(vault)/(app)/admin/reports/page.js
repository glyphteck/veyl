'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MessageCircleOff } from 'lucide-react';
import Loading from '@/components/loading';
import { Button } from '@/components/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Card } from '@/components/card';
import { useAdminData } from '@/components/providers/adminprovider';
import { displayUser } from '@/lib/admin/format';
import { toast } from '@/components/notifications';

export default function AdminPage() {
    const { offenders, offendersReady, banUser, unbanUser } = useAdminData();
    const [banningKey, setBanningKey] = useState('');

    const handleModeration = async (event, offender, feature) => {
        event.preventDefault();
        event.stopPropagation();
        const key = `${offender?.uid || ''}:${feature}`;
        if (!offender?.uid || banningKey === key) {
            return;
        }

        const isBanned = feature === 'avatar' ? offender.avatarBanned : offender.chatBanned;
        setBanningKey(key);
        try {
            if (isBanned) {
                await unbanUser(offender.uid, feature);
                toast(`${feature} unbanned ${displayUser(offender)}`);
            } else {
                await banUser(offender.uid, feature);
                toast(`${feature} banned ${displayUser(offender)}`);
            }
        } catch (error) {
            console.error('admin moderation failed', error);
            toast(isBanned ? 'unban failed' : 'ban failed');
        } finally {
            setBanningKey('');
        }
    };

    const handleAvatarModeration = (event, offender) => {
        if (banningKey === `${offender?.uid || ''}:avatar`) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        void handleModeration(event, offender, 'avatar');
    };

    if (!offendersReady) {
        return <Loading />;
    }

    if (offendersReady && offenders.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <Card className="w-full h-full">
                    <div className="flex h-full items-center justify-center px-4 py-2">
                        <p className="text-2xl text-muted">no reported users</p>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="w-full h-full">
            <Card className="w-full h-full">
                <div className="h-full overflow-y-auto">
                    <div className={`divide-y ${offenders.length < 12 ? 'border-b' : ''}`}>
                        {offenders.map((offender) => (
                            <div key={offender.uid} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left">
                                <Link href={`/admin/reports/${offender.slug}`} className="group flex min-w-0 items-center gap-2.5 pr-4">
                                    <Avatar active={offender.active} bot={!!offender?.bot} className="grower">
                                        <AvatarImage src={offender.avatar} alt={displayUser(offender)} />
                                        <AvatarFallback />
                                    </Avatar>
                                    <div className="min-w-0">
                                        <p className="truncate">
                                            <span>{displayUser(offender)}</span>
                                            <span className="text-muted"> · {offender.uid}</span>
                                        </p>
                                        <p className="truncate text-sm text-muted">reports: {offender.count}</p>
                                    </div>
                                </Link>
                                <div className="flex items-center gap-3">
                                    <Button className={`grower-lg ${offender.chatBanned ? 'text-destructive' : 'text-active'}`} onClick={(event) => handleModeration(event, offender, 'chat')} disabled={banningKey === `${offender.uid}:chat`} title={offender.chatBanned ? 'unban chat' : 'ban chat'}>
                                        <MessageCircleOff className="size-6" />
                                    </Button>
                                    <Button
                                        className={`grower-lg size-10 p-0 ${offender.avatarBanned ? 'text-destructive' : 'text-active'}`}
                                        onClick={(event) => handleAvatarModeration(event, offender)}
                                        disabled={banningKey === `${offender.uid}:avatar`}
                                        title={offender.avatarBanned ? 'unban avatar' : 'ban avatar'}
                                    >
                                        <Avatar className="pointer-events-none size-10">
                                            <AvatarFallback />
                                        </Avatar>
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
