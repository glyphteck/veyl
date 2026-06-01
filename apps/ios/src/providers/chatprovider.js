import { AppState } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { IOS_CHAT_WARMING } from '@veyl/shared/chat/messages/session/config';
import { createChat, createChatProvider } from '@veyl/shared/providers/chatprovider';
import { db, functions, storage } from '@/lib/firebase';
import { readMessageFileNative, uploadAttachmentMsgNative } from '@/lib/chat/media';
import { preloadMessageMediaUri } from '@/lib/chat/downloads';
import { useVault } from '@/providers/vaultprovider';
import { useUser } from '@/providers/userprovider';
import { mark } from '@/lib/diagnostics';

async function reserveChatMediaUpload(payload) {
    await httpsCallable(functions, 'reserveChatMediaUpload')(payload);
    return true;
}

const chat = createChat({
    db,
    storage,
    uploadAttachment(senderPubkey, senderPrivkey, receiverChatPK, attachment) {
        return uploadAttachmentMsgNative(storage, senderPubkey, senderPrivkey, receiverChatPK, {
            ...attachment,
            meta: {
                ...(attachment?.meta || {}),
                reserveChatMediaUpload,
            },
        });
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
