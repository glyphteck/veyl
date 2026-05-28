'use client';

import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { formatUserDisplay } from '@/lib/utils';
import { getMsgPreview as displayLastMsg } from '@glyphteck/shared/chat/messages';
import { useEffect } from 'react';

export default function ChatTitleLayout({ children }) {
    const { chatPK, settings } = useUser();
    const { chats, selectedChatId, isChatDataReady } = useChat();
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
        const peerChatPK = selectedChat.participants.find((p) => p !== chatPK);
        const profile = peerByChatPK.get(peerChatPK) ?? null;
        const displayName = formatUserDisplay({
            username: profile?.username,
            chatPK: peerChatPK,
        });
        const preview = displayLastMsg(selectedChat.lastMsg, chatPK, settings, bitcoin.price);
        document.title = `${displayName}: ${preview}`;
    }, [chats, selectedChatId, isChatDataReady, chatPK, peerByChatPK, settings.moneyFormat, bitcoin.price, cloaked]);

    return children;
}
