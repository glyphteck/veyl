'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserRoundPlus } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Button } from '@/components/button';
import { formatUserDisplay } from '@veyl/shared/profile';

const PEER_GRID_BATCH = 24;
const PEER_GRID_LOAD_MARGIN = 48;
const EMPTY_PEERS = Object.freeze([]);

export const PEER_GRID_HEIGHT = 'calc((80px + 24px) * 3 + 16px)';

export function usePeerGrid(peers) {
    const list = Array.isArray(peers) ? peers : EMPTY_PEERS;
    const [limit, setLimit] = useState(PEER_GRID_BATCH);
    const visiblePeers = useMemo(() => list.slice(0, limit), [list, limit]);

    useEffect(() => {
        setLimit(PEER_GRID_BATCH);
    }, [list]);

    const handlePeerScroll = useCallback(
        (event) => {
            const el = event.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight > PEER_GRID_LOAD_MARGIN) return;
            setLimit((current) => Math.min(list.length, current + PEER_GRID_BATCH));
        },
        [list.length]
    );

    return { visiblePeers, handlePeerScroll };
}

export function PeerGridCell({ peer, onClick, selected }) {
    return (
        <Button type="button" onClick={() => onClick(peer)} className="h-auto flex-col rounded-none p-0 shrinker">
            <Avatar active={peer?.active} selected={selected} bot={!!peer?.bot} className="size-16">
                <AvatarImage src={peer?.avatar} alt={peer?.username} />
                <AvatarFallback />
            </Avatar>
            <span className="text-sm font-bold truncate max-w-20">{formatUserDisplay(peer, true)}</span>
        </Button>
    );
}

export function PeerGridInviteCell({ onClick }) {
    return (
        <Button type="button" onClick={onClick} className="h-auto flex-col rounded-none p-0 shrinker" title="copy invite link">
            <span className="flex size-16 items-center justify-center rounded-full bg-background shadow-sm">
                <UserRoundPlus className="size-9 stroke-2" />
            </span>
            <span className="text-sm font-bold truncate max-w-20">invite</span>
        </Button>
    );
}
