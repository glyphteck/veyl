import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { CircleArrowRight, CircleCheck, HandCoins, Loader, Paperclip, Search } from 'lucide-react';
import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useSearch } from '@/lib/search/usesearch';
import { makeTxt } from '@glyphteck/shared/chat/messages';
import { getChatId } from '@glyphteck/shared/crypto/chat';
import { mergeProfiles } from '@glyphteck/shared/search/merge';
import { formatUserDisplay } from '@/lib/utils';
import { prepareChatFile } from '@/lib/chatfiles';
import { toast } from 'sonner';

function PeerCell({ peer, onSelect, selected }) {
    return (
        <Button type="button" onClick={() => onSelect(peer)} className="h-auto flex-col rounded-none p-0 shrinker">
            <Avatar active={peer?.active} selected={selected} bot={!!peer?.bot} className="size-16">
                <AvatarImage src={peer?.avatar} alt={peer?.username} />
                <AvatarFallback />
            </Avatar>
            <span className="text-sm font-bold truncate max-w-20">{formatUserDisplay(peer, true)}</span>
        </Button>
    );
}

export default function NewChat({ close }) {
    const router = useRouter();
    const { uid, chatPK, chatBanned } = useUser();
    const { chats, sendMessage, sendAttachment, selectChat } = useChat();
    const { peers, recentPeers } = usePeer();
    const { openDialog } = useDialog();
    const { cloaked } = useCloak();
    const { balance } = useWallet();
    const { searching, results, query, search, clearSearch } = useSearch('profiles');
    const [searchValue, setSearchValue] = useState('');
    const [selectedPeer, setSelectedPeer] = useState(null);
    const [msgContent, setMsgContent] = useState('');
    const inputRef = useRef(null);
    const msgRef = useRef(null);
    const fileRef = useRef(null);

    // peers who already have a chat
    const chatPeerPKs = useMemo(() => {
        const set = new Set();
        for (const chat of chats || []) {
            for (const pk of chat.participants || []) {
                if (pk !== chatPK) set.add(pk);
            }
        }
        return set;
    }, [chats, chatPK]);

    // default list: peers without an existing chat
    const defaultPeers = useMemo(() => {
        const list = Array.isArray(recentPeers?.all) ? recentPeers.all : [];
        return list.filter((p) => p.uid !== uid && p.chatPK && !chatPeerPKs.has(p.chatPK));
    }, [recentPeers?.all, uid, chatPeerPKs]);

    const hasChatKey = useCallback((peer) => !!peer?.chatPK, []);

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

    const displayPeers = query ? searchPeers : defaultPeers;

    const handleSearchChange = (e) => {
        const value = e.target.value;
        setSearchValue(value);
        if (value) {
            search(value);
        } else {
            clearSearch();
        }
    };

    const handleSelect = (peer) => {
        setSelectedPeer(peer);
        setMsgContent('');
        setTimeout(() => msgRef.current?.focus(), 0);
    };

    const handlePayments = () => {
        if (!selectedPeer) return;
        openDialog('payments', { peer: selectedPeer });
    };

    const handlePickAttachment = () => {
        if (!selectedPeer?.chatPK) return;
        fileRef.current?.click?.();
    };

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !selectedPeer?.chatPK) return;
        close();
        selectChat(getChatId(chatPK, selectedPeer.chatPK));
        router.push('/chat');
        try {
            await sendAttachment(selectedPeer.chatPK, await prepareChatFile(file));
            toast(`sent attachment to ${formatUserDisplay(selectedPeer, false)}`, { icon: <CircleCheck /> });
        } catch (error) {
            toast.error(error?.message || 'failed to send attachment');
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!msgContent.trim() || !selectedPeer?.chatPK || !chatPK) return;
        const messageToSend = msgContent.trim();
        setMsgContent('');
        close();
        try {
            const message = makeTxt(messageToSend);
            const newChatId = getChatId(chatPK, selectedPeer.chatPK);
            const sendPromise = sendMessage(selectedPeer.chatPK, message);
            selectChat(newChatId);
            router.push('/chat');
            await sendPromise;
            const truncated = messageToSend.length > 28 ? messageToSend.substring(0, 28) + '...' : messageToSend;
            toast(`sent message to ${formatUserDisplay(selectedPeer, false)}`, {
                ...(cloaked ? {} : { description: truncated }),
                icon: <CircleCheck />,
            });
        } catch (error) {
            toast('Failed to send message.');
        }
    };

    const showInput = !chatBanned;

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
                    {searching && query && !displayPeers.length ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader className="animate-spin size-6 text-muted" />
                        </div>
                    ) : displayPeers.length > 0 ? (
                        <div className="grid grid-cols-4 gap-4">
                            {displayPeers.map((peer) => (
                                <PeerCell key={peer.uid} peer={peer} onSelect={handleSelect} selected={selectedPeer?.uid === peer.uid} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted text-sm">{query ? 'no results' : 'search for a user'}</div>
                    )}
                </div>
            </Card>
            {showInput && (
                <form onSubmit={handleSendMessage} className={`w-full transition-opacity ${selectedPeer ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <div className="flex items-end relative">
                        <input ref={fileRef} type="file" hidden onChange={handleFileChange} />
                        <Input
                            ref={msgRef}
                            value={msgContent}
                            onChange={(e) => setMsgContent(e.target.value)}
                            placeholder={selectedPeer ? `message ${formatUserDisplay(selectedPeer, true)}` : 'send a message'}
                            end={
                                msgContent.trim() ? (
                                    <Button type="submit" className="grower-lg">
                                        <CircleArrowRight />
                                    </Button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Button type="button" className="grower-lg" onClick={handlePickAttachment}>
                                            <Paperclip />
                                        </Button>
                                        {selectedPeer?.walletPK && (
                                            <Button type="button" className="grower-lg" onClick={handlePayments}>
                                                <HandCoins />
                                            </Button>
                                        )}
                                    </div>
                                )
                            }
                            endPos="right-2.5 bottom-2"
                            endPad="pr-20"
                            className={cloaked ? 'cloaked' : ''}
                            maxLength={256}
                        />
                    </div>
                </form>
            )}
        </div>
    );
}
