'use client';

import { RecentChatsList } from '@/components/chat/recentchatslist';
import { Chatbox } from '@/components/chat/chatbox';
import { Button } from '@/components/button';
import Loading from '@/components/loading';
import { MessageCircle } from 'lucide-react';
import { useChat } from '@/components/providers/chatprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useUser } from '@/components/providers/userprovider';

export default function ChatPage() {
    const { hasChats, isChatDataReady, selectedChatId } = useChat();
    const { openDialog } = useDialog();
    const { chatBanned } = useUser();

    const handleStartChat = () => {
        openDialog('newchat');
    };

    if (chatBanned) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <p className="text-2xl font-black">chat unavailable</p>
                    <p className="text-lg text-muted mt-2">Glyphteck Corp has restricted chat on this account. Wallet features still work normally.</p>
                </div>
            </div>
        );
    }

    if (!isChatDataReady) {
        return (
            <div className="relative h-full">
                <Loading overlay />
            </div>
        );
    }

    if (!hasChats && !selectedChatId) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <p className="text-lg text-muted">You have no chats yet.</p>
                    <Button onClick={handleStartChat} className="button-fill shrinker text-lg w-3xs mt-4">
                        <MessageCircle />
                        start chatting
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex gap-2">
            <div className="flex-1 min-w-16 max-w-16 md:min-w-2xs md:max-w-full ">
                <RecentChatsList />
            </div>
            <div className="flex-4 min-w-0">
                <Chatbox />
            </div>
        </div>
    );
}
