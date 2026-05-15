import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader, Search } from 'lucide-react';
import { Card } from '@/components/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';
import { useSearch } from '@/lib/search/usesearch';
import { formatUserDisplay } from '@/lib/utils';
import { mergeProfiles } from '@glyphteck/shared/search/merge';

function PeerCell({ peer, onToggle, selected }) {
    return (
        <button onClick={() => onToggle(peer)} className="flex flex-col items-center cursor-pointer shrinker">
            <Avatar active={peer?.active} selected={selected} bot={!!peer?.bot} className="size-16">
                <AvatarImage src={peer?.avatar} alt={peer?.username} />
                <AvatarFallback />
            </Avatar>
            <span className="text-sm font-bold truncate max-w-20">{formatUserDisplay(peer, true)}</span>
        </button>
    );
}

export default function Share({ onShare, disabled = false, busy = false, label }) {
    const { uid } = useUser();
    const { peers } = usePeer();
    const { searching, results, query, search, clearSearch } = useSearch('profiles');
    const [searchValue, setSearchValue] = useState('');
    const [selected, setSelected] = useState([]);
    const inputRef = useRef(null);

    useEffect(() => clearSearch, [clearSearch]);

    const hasChatKey = useCallback((peer) => !!peer?.chatPK, []);

    const allPeers = useMemo(() => {
        if (!peers?.length) return [];
        return peers.filter((peer) => peer.uid !== uid && peer.chatPK);
    }, [peers, uid]);

    const searchPeers = useMemo(
        () =>
            mergeProfiles({
                local: peers || [],
                remote: results || [],
                parsed: query,
                excludeUid: uid,
                extraFilter: hasChatKey,
            }),
        [hasChatKey, peers, query, results, uid]
    );

    const displayPeers = query ? searchPeers : allPeers;
    const selectedUids = useMemo(() => new Set(selected.map((peer) => peer.uid)), [selected]);
    const submitLabel = label?.(selected) || (selected.length > 1 ? `send to ${selected.length} people` : selected.length === 1 ? `send to ${formatUserDisplay(selected[0], true)}` : 'select recipients');

    const handleSearchChange = useCallback(
        (event) => {
            const value = event.target.value;
            setSearchValue(value);
            if (value) search(value);
            else clearSearch();
        },
        [clearSearch, search]
    );

    const togglePeer = useCallback((peer) => {
        setSelected((prev) => {
            const exists = prev.find((item) => item.uid === peer.uid);
            return exists ? prev.filter((item) => item.uid !== peer.uid) : [...prev, peer];
        });
    }, []);

    const handleShare = useCallback(() => {
        onShare?.(selected);
    }, [onShare, selected]);

    return (
        <div className="flex flex-col gap-3 w-lg">
            <Input
                ref={inputRef}
                value={searchValue}
                onChange={handleSearchChange}
                placeholder="search for a user"
                start={<Search className="pointer-events-none size-5 text-muted" />}
                startPos="left-2.5 top-1/2 -translate-y-1/2"
                startPad="pl-9"
                autoFocus
            />
            <Card>
                <div className="overflow-y-scroll p-4" style={{ height: 'calc((80px + 24px) * 3 + 16px)' }}>
                    {searching && query ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader className="animate-spin size-6 text-muted" />
                        </div>
                    ) : displayPeers.length > 0 ? (
                        <div className="grid grid-cols-4 gap-4">
                            {displayPeers.map((peer) => (
                                <PeerCell key={peer.uid} peer={peer} onToggle={togglePeer} selected={selectedUids.has(peer.uid)} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted text-sm">{query ? 'no results' : 'no peers yet'}</div>
                    )}
                </div>
            </Card>
            <Button onClick={handleShare} disabled={disabled || busy || !selected.length} className="w-full grower-sm button-outline">
                {busy ? <Loader className="animate-spin size-4 mr-2" /> : null}
                {submitLabel}
            </Button>
        </div>
    );
}
