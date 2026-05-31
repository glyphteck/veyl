import { AppState } from 'react-native';
import { createUseChatMessages } from '@veyl/shared/chat/usemessages';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';
import { db } from '@/lib/firebase';

export const useChatMessages = createUseChatMessages({
    db,
    useChat,
    useUser,
    useVault,
    appState: AppState,
});
