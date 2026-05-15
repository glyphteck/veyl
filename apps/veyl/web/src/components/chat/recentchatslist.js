'use client';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Card } from '@/components/card';
import { formatUserDisplay, formatFullDateTime } from '@/lib/utils';
import { getMsgPreview as displayLastMsg } from '@glyphteck/shared/chat/messages';
import { useUser } from '@/components/providers/userprovider';
import { useChat, useChatInput } from '@/components/providers/chatprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';

export function RecentChatsList() {
    const { chatPK, settings } = useUser();
    const { chats, isChatDataReady, selectChat, selectedChatId } = useChat();
    const { focusChatInput } = useChatInput();
    const { peers, updatePeer } = usePeer();
    const { bitcoin } = useWallet();
    const { cloaked } = useCloak();

    const handleChatClick = (chatId) => {
        if (selectedChatId !== chatId) {
            selectChat(chatId);
        }
        focusChatInput();
    };

    if (!isChatDataReady) return;
    return (
        <Card>
            <div className="overflow-y-auto">
                <div className={`divide-y ${chats.length < 12 ? 'border-b' : ''}`}>
                    {chats.map((chat) => {
                        const peerChatPK = chat.participants.find((p) => p !== chatPK);
                        const profile = peers?.find((peer) => peer.chatPK === peerChatPK) ?? null;
                        const displayName = formatUserDisplay({
                            username: profile?.username,
                            walletPK: peerChatPK,
                        });

                        return (
                            <button
                                key={chat.id}
                                type="button"
                                className={`group w-full px-3 py-2 text-left ${chat.id === selectedChatId ? 'bg-foreground/5' : ''}`}
                                onClick={() => {
                                    if (selectedChatId !== chat.id && profile?.uid) {
                                        updatePeer(profile.uid, { refreshAvatar: true });
                                    }
                                    handleChatClick(chat.id);
                                }}
                            >
                                <div className="flex items-start gap-2.5">
                                    <Avatar active={profile?.active} bot={!!profile?.bot} className="grower">
                                        <AvatarImage src={profile?.avatar} alt={displayName} />
                                        <AvatarFallback />
                                    </Avatar>
                                    <div className="hidden min-w-0 flex-1 md:block">
                                        <div className="flex items-center justify-between">
                                            <span className="truncate font-black">{displayName}</span>
                                            <span className="ml-2 whitespace-nowrap text-sm text-muted">{chat.lastMsg ? formatFullDateTime(chat.lastMsg.ts?.toDate() || new Date()) : ''}</span>
                                        </div>
                                        <div className={`truncate text-sm ${chat.unseen ? 'text-foreground' : 'text-muted'} ${cloaked ? 'cloaked' : ''}`}>
                                            {displayLastMsg(chat.lastMsg, chatPK, settings, bitcoin.price)}
                                        </div>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </Card>
    );
}
