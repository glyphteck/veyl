import { AppState } from 'react-native';
import { createChat, createChatProvider } from '@glyphteck/shared/providers/chatprovider';
import { db, storage } from '@/lib/firebase';
import { readMessageFileNative, uploadAttachmentMsgNative } from '@/lib/chatmedia';
import { preloadMessageMediaUri } from '@/lib/chatdownloads';
import { useVault } from '@/providers/vaultprovider';
import { useUser } from '@/providers/userprovider';

const chat = createChat({
    db,
    storage,
    uploadAttachment(senderPubkey, senderPrivkey, receiverChatPK, attachment) {
        return uploadAttachmentMsgNative(storage, senderPubkey, senderPrivkey, receiverChatPK, attachment);
    },
    readMessageFile(storageInstance, userChatPK, userPrivKey, peerChatPK, message) {
        return readMessageFileNative(storageInstance, userChatPK, userPrivKey, peerChatPK, message);
    },
});

const chatWarming = {
    enabled: true,
    eagerCount: 5,
    count: 10,
    delayMs: 900,
    media: {
        enabled: true,
    },
};

const { ChatProvider, useChat } = createChatProvider({
    chat,
    useVault,
    useUser,
    appState: AppState,
    chatWarming,
    preloadMessageMedia: preloadMessageMediaUri,
});

export { ChatProvider, useChat };
