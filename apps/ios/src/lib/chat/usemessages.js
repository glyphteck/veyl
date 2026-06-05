import { AppState } from 'react-native';
import { createUseChatMessages } from '@veyl/shared/chat/usemessages';
import { useChat } from '@/providers/chatprovider';
import { useUser } from '@/providers/userprovider';
import { useVault } from '@/providers/vaultprovider';

export const useChatMessages = createUseChatMessages({
    useChat,
    useUser,
    useVault,
    appState: AppState,
});
