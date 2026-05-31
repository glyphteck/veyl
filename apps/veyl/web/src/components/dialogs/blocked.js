'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/card';
import { Button } from '@/components/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Loader, UserX } from 'lucide-react';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';
import { formatUserDisplay } from '@veyl/shared/profile';

function BlockedRow({ peer, busy, onUnblock }) {
    return (
        <div className="flex items-center gap-3 py-3">
            <Avatar active={peer?.active} bot={!!peer?.bot} className="size-11 shrink-0">
                <AvatarImage src={peer?.avatar} alt={peer?.username || 'user'} />
                <AvatarFallback />
            </Avatar>
            <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-black">{formatUserDisplay(peer, true)}</div>
            </div>
            <Button className="button-outline shrinker" disabled={busy} onClick={() => onUnblock(peer)}>
                {busy ? <Loader className="size-5 animate-spin" /> : 'unblock'}
            </Button>
        </div>
    );
}

export default function Blocked() {
    const { blockedPeers, blockedPeersReady, loadBlockedPeers, restorePeer } = usePeer() || {};
    const { unblockPeer } = useUser();
    const [busyUid, setBusyUid] = useState(null);

    useEffect(() => {
        void loadBlockedPeers?.();
    }, [loadBlockedPeers]);

    const blockedItems = useMemo(() => (Array.isArray(blockedPeers) ? blockedPeers : []), [blockedPeers]);

    const handleUnblock = useCallback(
        async (peer) => {
            if (!peer?.uid || busyUid) {
                return;
            }

            setBusyUid(peer.uid);
            try {
                await unblockPeer?.(peer);
                restorePeer?.(peer);
            } catch (error) {
                console.error('unblock peer failed', error);
            } finally {
                setBusyUid(null);
            }
        },
        [busyUid, restorePeer, unblockPeer]
    );

    return (
        <Card className="w-lg max-w-[calc(100vw-2rem)]">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2 text-3xl font-black">
                <UserX className="size-7" />
                <span>blocked users</span>
            </div>
            <div className="px-4 pt-2 pb-2">
                {blockedItems.length ? (
                    <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto pr-1">
                        {blockedItems.map((peer) => (
                            <BlockedRow key={peer.uid} peer={peer} busy={busyUid === peer.uid} onUnblock={handleUnblock} />
                        ))}
                    </div>
                ) : (
                    <div className="py-8 text-center text-muted">{blockedPeersReady ? 'no blocked users' : 'loading blocked users…'}</div>
                )}
            </div>
        </Card>
    );
}
