import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MessageCircle, Search } from 'lucide-react-native';
import { mergeProfiles } from '@veyl/shared/search/merge';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { formatUserDisplay } from '@veyl/shared/profile';
import { truncateLabel } from '@veyl/shared/utils/display';
import { cleanText } from '@veyl/shared/utils/text';
import { waitForIdle } from '@veyl/shared/utils/async';
import { CAMERA_MEDIA_RECIPIENT_MAX } from '@veyl/shared/config';

import { useTheme } from '@/providers/themeprovider';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';
import { useChat } from '@/providers/chatprovider';
import { useSearch } from '@/lib/search/usesearch';
import { prepareAssetForChatUpload } from '@/lib/chat/media';
import EmptyState from '@/components/emptystate';
import GlassButton from '@/components/glass/glassbutton';
import PeerPicker, { PEER_PICKER_BUTTON_FOOTER_HEIGHT } from '@/components/peerpicker';

export default function SendPhotoScreen() {
    const { theme } = useTheme();
    const { peers, recentPeers } = usePeer() || {};
    const { uid, chatBanned } = useUser();
    const { sendAttachmentMany, sendImageMany, selectPeerChat } = useChat();
    const { searching, results, query, search: runSearch, clearSearch } = useSearch('profiles');
    const router = useRouter();
    const params = useLocalSearchParams();

    const photoUri = textRouteParam(params?.uri);
    const photoWidth = Number(textRouteParam(params?.w)) || 0;
    const photoHeight = Number(textRouteParam(params?.h)) || 0;
    const mediaType = textRouteParam(params?.t) === 'mp4' ? 'video' : 'photo';
    const mediaName = cleanText(textRouteParam(params?.n));

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
        };
    }, [clearSearch]);

    const togglePeer = useCallback(
        (peer) => {
            const exists = selected.some((p) => p.uid === peer.uid);
            if (!exists && selected.length >= CAMERA_MEDIA_RECIPIENT_MAX) {
                Alert.alert('Too many people', `Pick up to ${CAMERA_MEDIA_RECIPIENT_MAX} people at once.`);
                return;
            }
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
        const requireChat = (peer) => !!peer?.chatPK;
        if (!search.trim()) {
            const recent = [...(recentPeers?.chat || []), ...(recentPeers?.wallet || [])];
            return Array.from(new Map(recent.filter((peer) => peer?.uid && peer.uid !== uid && peer.chatPK).map((peer) => [peer.uid, peer])).values());
        }
        if (!query) return [];
        return mergeProfiles({
            local: list,
            remote: results || [],
            parsed: query,
            excludeUid: uid,
            extraFilter: requireChat,
        });
    }, [peers, query, recentPeers, results, search, uid]);

    const handleSend = useCallback(async () => {
        if (!photoUri || !selected.length || sending || busyRef.current || chatBanned) return;
        const recipients = selected.slice(0, CAMERA_MEDIA_RECIPIENT_MAX);
        busyRef.current = true;
        setSending(true);

        if (openRef.current) router.dismiss();
        DeviceEventEmitter.emit('photosent');

        waitForIdle({ timeout: 250 })
            .then(() =>
                prepareAssetForChatUpload({
                    uri: photoUri,
                    width: photoWidth,
                    height: photoHeight,
                    mimeType: mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
                    preserveImage: mediaType === 'photo',
                    ...(mediaName ? { fileName: mediaName, name: mediaName } : {}),
                })
            )
            .then(async (prepared) => {
                const targets = recipients.map((peer) => peer.chatPK);
                const results = mediaType === 'video' ? await sendAttachmentMany(targets, prepared) : await sendImageMany(targets, prepared);
                const resultByChatPK = new Map(results.map((result) => [result.peerChatPK, result]));

                for (const peer of recipients) {
                    const result = resultByChatPK.get(peer.chatPK);
                    if (result?.ok) {
                        if (recipients.length === 1) {
                            await selectPeerChat?.(peer.chatPK);
                        }
                    } else {
                        console.warn(`send ${mediaType} failed:`, result?.error);
                    }
                }
            })
            .catch((error) => {
                console.warn(`prepare ${mediaType} failed:`, error);
            })
            .finally(() => {
                busyRef.current = false;
            });
    }, [chatBanned, mediaName, mediaType, photoHeight, photoUri, photoWidth, router, selectPeerChat, selected, sendAttachmentMany, sendImageMany, sending]);

    const selectedUids = useMemo(() => new Set(selected.map((p) => p.uid)), [selected]);
    const hasSelection = selected.length > 0;
    const sendLabel = selected.length > 1 ? `send to ${selected.length} people` : selected.length === 1 ? `send to ${truncateLabel(formatUserDisplay(selected[0]), 12, '…')}` : 'send';

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
                    <EmptyState icon={MessageCircle} title="no recent friends" />
                )
            }
            footer={<GlassButton onPress={handleSend} label={sendLabel} accent disabled={!hasSelection || sending || chatBanned} pressableStyle={{ width: '100%' }} />}
        />
    );
}
