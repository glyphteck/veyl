import { AppState } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { IOS_CHAT_WARMING } from '@glyphteck/shared/chat/messages/session/config';
import { createChat, createChatProvider } from '@glyphteck/shared/providers/chatprovider';
import { db, functions, storage } from '@/lib/firebase';
import { readMessageFileNative, uploadAttachmentMsgNative } from '@/lib/chatmedia';
import { preloadMessageMediaUri } from '@/lib/chatdownloads';
import { useVault } from '@/providers/vaultprovider';
import { useUser } from '@/providers/userprovider';
import { mark } from '@/lib/diagnostics';

const chat = createChat({
    db,
    storage,
    uploadAttachment(senderPubkey, senderPrivkey, receiverChatPK, attachment) {
        return uploadAttachmentMsgNative(storage, senderPubkey, senderPrivkey, receiverChatPK, attachment);
    },
    readMessageFile(storageInstance, userChatPK, userPrivKey, peerChatPK, message) {
        return readMessageFileNative(storageInstance, userChatPK, userPrivKey, peerChatPK, message);
    },
    async setMediaSaved(path, stayId, stayKey, saved) {
        await httpsCallable(functions, 'setMediaSaved')({ path, stayId, stayKey, saved });
        return true;
    },
    async finishDeletingChat(chatId) {
        await httpsCallable(functions, 'deleteChat')({ chatId });
        return true;
    },
});

const { ChatProvider, useChat } = createChatProvider({
    chat,
    useVault,
    useUser,
    appState: AppState,
    chatWarming: IOS_CHAT_WARMING,
    preloadMessageMedia: preloadMessageMediaUri,
    diag: mark,
});

export { ChatProvider, useChat };
