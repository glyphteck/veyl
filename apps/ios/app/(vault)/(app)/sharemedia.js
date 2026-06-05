import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MessageCircle, Search } from 'lucide-react-native';
import { mergeProfiles } from '@veyl/shared/search/merge';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { formatUserDisplay } from '@veyl/shared/profile';
import { truncateLabel } from '@veyl/shared/utils/display';

import { useTheme } from '@/providers/themeprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useChat } from '@/providers/chatprovider';
import { useSearch } from '@/lib/search/usesearch';
import { clearShareMedia, readShareMedia, readShareMediaBytes } from '@/lib/chat/share';
import EmptyState from '@/components/emptystate';
import GlassButton from '@/components/glass/glassbutton';
import PeerPicker, { PEER_PICKER_BUTTON_FOOTER_HEIGHT } from '@/components/peerpicker';

export default function ShareMediaScreen() {
    const { theme } = useTheme();
    const { peers, recentPeers } = usePeer() || {};
    const { uid, chatBanned } = useUser();
    const { share, selectPeerChat } = useChat();
    const { searching, results, query, search: runSearch, clearSearch } = useSearch('profiles');
    const router = useRouter();
    const params = useLocalSearchParams();
    const shareId = textRouteParam(params?.id);
    const msg = useMemo(() => readShareMedia(shareId), [shareId]);

    const searchInputRef = useRef(null);
    const openRef = useRef(true);
    const busyRef = useRef(false);

    const [selected, setSelected] = useState([]);
    const [lastSelectedPeer, setLastSelectedPeer] = useState(null);
    const [search, setSearch] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        return () => {
            openRef.current = false;
            clearSearch();
            clearShareMedia(shareId);
        };
    }, [clearSearch, shareId]);

    const togglePeer = useCallback(
        (peer) => {
            const exists = selected.some((p) => p.uid === peer.uid);
            const next = exists ? selected.filter((p) => p.uid !== peer.uid) : [...selected, peer];
            setSelected(next);
            setLastSelectedPeer(exists ? next.at(-1) || null : peer);
        },
        [selected]
    );

    const handleSearchChange = useCallback(
        (value) => {
            setSearch(value);
            runSearch(value);
        },
        [runSearch]
    );

    const handleClearSearch = useCallback(() => {
        setSearch('');
        clearSearch();
    }, [clearSearch]);

    const filteredPeers = useMemo(() => {
        const list = Array.isArray(peers) ? peers : [];
        const recent = Array.isArray(recentPeers?.chat) ? recentPeers.chat : [];
        const requireChat = (peer) => !!peer?.chatPK;
        if (!search.trim()) return recent.filter((p) => p.uid !== uid && p.chatPK);
        if (!query) return [];
        return mergeProfiles({
            local: list,
            remote: results || [],
            parsed: query,
            excludeUid: uid,
            extraFilter: requireChat,
        });
    }, [peers, query, recentPeers?.chat, results, search, uid]);

    const handleSend = useCallback(async () => {
        if (!msg || !selected.length || sending || busyRef.current || chatBanned) return;
        busyRef.current = true;
        setSending(true);

        if (openRef.current) router.dismiss();

        try {
            const shareData = await readShareMediaBytes(msg).catch(() => null);
            const results = await share(selected.map((peer) => peer.chatPK), msg, { sourcePeerChatPK: msg?.peerChatPK, data: shareData });
            for (const [index, peer] of selected.entries()) {
                try {
                    const result = results[index];
                    if (result?.ok === false) {
                        throw result.error || new Error('share failed');
                    }
                    if (selected.length === 1) {
                        await selectPeerChat?.(peer.chatPK);
                    }
                } catch (error) {
                    console.warn('share media failed:', error);
                }
            }
        } finally {
            busyRef.current = false;
        }
    }, [chatBanned, msg, router, selectPeerChat, selected, share, sending]);

    const selectedUids = useMemo(() => new Set(selected.map((p) => p.uid)), [selected]);
    const hasSelection = selected.length > 0;
    const sendLabel = selected.length > 1 ? `send to ${selected.length} people` : selected.length === 1 ? `send to ${truncateLabel(formatUserDisplay(selected[0]), 12)}` : 'send';

    return (
        <PeerPicker
            searchInputRef={searchInputRef}
            search={search}
            onSearchChange={handleSearchChange}
            onClearSearch={handleClearSearch}
            searching={searching}
            peers={filteredPeers}
            theme={theme}
            onPeerPress={togglePeer}
            peerHapticIn="selection"
            isPeerSelected={(peer) => selectedUids.has(peer.uid)}
            isPeerDisabled={(peer) => !peer?.chatPK}
            footerOpen={hasSelection}
            footerInteractive={hasSelection && !sending}
            footerScrollPeer={lastSelectedPeer || selected[0]}
            footerHeight={PEER_PICKER_BUTTON_FOOTER_HEIGHT}
            emptyState={
                searching ? (
                    <EmptyState busy title="searching..." />
                ) : search && !query ? (
                    <EmptyState icon={Search} title="type a username" />
                ) : search ? (
                    <EmptyState icon={Search} title="no matches" />
                ) : (
                    <EmptyState icon={MessageCircle} title={msg ? 'no recent friends' : 'file unavailable'} />
                )
            }
            footer={<GlassButton onPress={handleSend} label={sendLabel} accent disabled={!msg || !hasSelection || sending || chatBanned} pressableStyle={{ width: '100%' }} />}
        />
    );
}
