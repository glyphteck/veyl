import { AppState } from 'react-native';
import { IOS_CHAT_WARMING } from '@veyl/shared/chat/messages/session/config';
import { createChatProvider } from '@veyl/shared/providers/chatprovider';
import { cloud } from '@/lib/cloud';
import { readMessageFileNative, uploadAttachmentMsgNative } from '@/lib/chat/media';
import { preloadMessageMediaUri } from '@/lib/chat/downloads';
import { useVault } from '@/providers/vaultprovider';
import { useUser } from '@/providers/userprovider';
import { mark } from '@/lib/diagnostics';

const media = {
    uploadAttachment(senderPubkey, senderPrivkey, receiverChatPK, attachment) {
        return uploadAttachmentMsgNative(senderPubkey, senderPrivkey, receiverChatPK, {
            ...attachment,
            meta: {
                ...(attachment?.meta || {}),
                uploadChatMedia: cloud.chat.media.upload,
            },
        });
    },
    readMessageFile(readChatMedia, userChatPK, userPrivKey, peerChatPK, message) {
        return readMessageFileNative(readChatMedia, userChatPK, userPrivKey, peerChatPK, message);
    },
};

const { ChatProvider, useChat } = createChatProvider({
    cloud,
    media,
    useVault,
    useUser,
    appState: AppState,
    chatWarming: IOS_CHAT_WARMING,
    preloadMessageMedia: preloadMessageMediaUri,
    diag: mark,
});

export { ChatProvider, useChat };
