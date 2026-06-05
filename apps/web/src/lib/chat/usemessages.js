'use client';

import { createUseChatMessages } from '@veyl/shared/chat/usemessages';
import { useChat } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { useVault } from '@/components/providers/vaultprovider';

export const useChatMessages = createUseChatMessages({
    useChat,
    useUser,
    useVault,
});
