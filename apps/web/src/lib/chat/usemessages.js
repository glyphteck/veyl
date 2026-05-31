'use client';

import { createUseChatMessages } from '@veyl/shared/chat/usemessages';
import { useChat } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { db } from '@/lib/firebase/firebaseclient';

export const useChatMessages = createUseChatMessages({
    db,
    useChat,
    useUser,
    useVault,
});
