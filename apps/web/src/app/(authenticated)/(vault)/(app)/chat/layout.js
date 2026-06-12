'use client';

import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { formatUserDisplay } from '@veyl/shared/profile';
import { getChatPeerPK } from '@veyl/shared/chat/ids';
import { getMsgPreview as displayPreview } from '@veyl/shared/chat/messages';
import { useEffect } from 'react';

export default function ChatTitleLayout({ children }) {
    const { chatPK, settings } = useUser();
    const { chats, selectedChatId, isChatDataReady, previewNow } = useChat();
    const { peerByChatPK } = usePeer();
    const bitcoin = useBitcoin();
    const { cloaked } = useCloak();

    useEffect(() => {
        if (cloaked || !isChatDataReady || !selectedChatId) {
            document.title = 'chat';
            return;
        }
        // Find the selected chat
        const selectedChat = chats.find((chat) => chat.id === selectedChatId);
        if (!selectedChat) {
            document.title = 'chat';
            return;
        }
        // Find peer info for the selected chat
        const peerChatPK = getChatPeerPK(selectedChat, chatPK);
        const profile = peerByChatPK.get(peerChatPK) ?? null;
        const displayName = formatUserDisplay({
            username: profile?.username,
            chatPK: peerChatPK,
        });
        const preview = displayPreview(selectedChat.preview, chatPK, settings, bitcoin.price, { now: previewNow });
        document.title = preview ? `${displayName}: ${preview}` : displayName;
    }, [chats, selectedChatId, isChatDataReady, chatPK, peerByChatPK, settings, bitcoin.price, cloaked, previewNow]);

    return children;
}
