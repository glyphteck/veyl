import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/card';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { PEER_GRID_HEIGHT, PeerGridCell, usePeerGrid } from '@/components/peergrid';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';
import { useSearch } from '@/lib/search/usesearch';
import { formatUserDisplay } from '@veyl/shared/profile';
import { mergeProfiles } from '@veyl/shared/search/merge';

function cleanMaxPeers(value) {
    const max = Number(value);
    return Number.isInteger(max) && max > 0 ? max : Infinity;
}

function defaultSubmitLabel(peers) {
    if (peers.length > 1) return `send to ${peers.length} people`;
    if (peers.length === 1) return `send to ${formatUserDisplay(peers[0], true)}`;
    return 'send';
}

export default function Share({ onShare, disabled = false, busy = false, label, maxPeers }) {
    const { uid } = useUser();
    const { peers, recentPeers } = usePeer();
    const { searching, results, query, search, clearSearch } = useSearch('profiles');
    const [searchValue, setSearchValue] = useState('');
    const [selected, setSelected] = useState([]);
    const inputRef = useRef(null);
    const lastSelectedRef = useRef([]);
    const selectedMax = cleanMaxPeers(maxPeers);

    useEffect(() => clearSearch, [clearSearch]);

    const hasChatKey = useCallback((peer) => !!peer?.chatPK, []);

    const allPeers = useMemo(() => {
        const list = Array.isArray(recentPeers?.chat) ? recentPeers.chat : [];
        return list.filter((peer) => peer.uid !== uid && peer.chatPK);
    }, [recentPeers?.chat, uid]);

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
    const { visiblePeers, handlePeerScroll } = usePeerGrid(displayPeers);
    const selectedUids = useMemo(() => new Set(selected.map((peer) => peer.uid)), [selected]);
    const hasSelection = selected.length > 0;
    if (hasSelection) lastSelectedRef.current = selected;
    const labelPeers = hasSelection ? selected : lastSelectedRef.current;
    const submitLabel = label?.(labelPeers) || defaultSubmitLabel(labelPeers);

    const handleSearchChange = useCallback(
        (event) => {
            const value = event.target.value;
            setSearchValue(value);
            if (value) search(value);
            else clearSearch();
        },
        [clearSearch, search]
    );

    const togglePeer = useCallback(
        (peer) => {
            const exists = selected.some((item) => item.uid === peer.uid);
            if (!exists && selected.length >= selectedMax) {
                toast.error(`pick up to ${selectedMax} people at once`);
                return;
            }
            setSelected(exists ? selected.filter((item) => item.uid !== peer.uid) : [...selected, peer]);
        },
        [selected, selectedMax]
    );

    const handleShare = useCallback(() => {
        onShare?.(selected.slice(0, selectedMax));
    }, [onShare, selected, selectedMax]);

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
                <div className="overflow-y-scroll p-4" style={{ height: PEER_GRID_HEIGHT }} onScroll={handlePeerScroll}>
                    {searching && query && !displayPeers.length ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader className="animate-spin size-6 text-muted" />
                        </div>
                    ) : displayPeers.length > 0 ? (
                        <div className="grid grid-cols-4 gap-4">
                            {visiblePeers.map((peer) => (
                                <PeerGridCell key={peer.uid} peer={peer} onClick={togglePeer} selected={selectedUids.has(peer.uid)} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted text-sm">{query ? 'no results' : 'search for a user'}</div>
                    )}
                </div>
            </Card>
            <div aria-hidden={!hasSelection} className={`transition-opacity ${hasSelection ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                <Button onClick={handleShare} disabled={disabled || busy || !hasSelection} className="w-full grower-sm button-outline">
                    {busy ? <Loader className="animate-spin size-4 mr-2" /> : null}
                    {submitLabel}
                </Button>
            </div>
        </div>
    );
}
