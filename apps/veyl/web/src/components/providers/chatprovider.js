'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { WEB_CHAT_WARMING } from '@glyphteck/shared/chat/warmingconfig';
import { createChat, createChatProvider } from '@glyphteck/shared/providers/chatprovider';
import { db, getFunctions, getStorage } from '@/lib/firebase/firebaseclient';
import { useUser } from '@/components/providers/userprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { preloadMessageMedia } from '@/components/chat/mediapreload';
import { clearMsgImageCache, seedMsgImage } from '@/components/chat/usemsgimage';
import { clearMsgVideoCache } from '@/components/chat/videomediacache';
import { clearAudioCache } from '@/components/chat/audiocache';

const chat = createChat({
    db,
    getStorage,
    async setMediaSaved(path, stayId, saved) {
        await httpsCallable(getFunctions(), 'setMediaSaved')({ path, stayId, saved });
        return true;
    },
    async finishDeletingChat(chatId) {
        await httpsCallable(getFunctions(), 'deleteChat')({ chatId });
        return true;
    },
});

const { ChatProvider: SharedChatProvider, useChat } = createChatProvider({
    chat,
    useUser,
    useVault,
    chatWarming: WEB_CHAT_WARMING,
    preloadMessageMedia,
    adoptLocalMessageMedia(message, local) {
        if (local?.localUri) {
            seedMsgImage(message, local.localUri, { priority: 4 });
        }
    },
});

const ChatInputContext = createContext(null);

function ChatMediaCacheCleaner() {
    const { lockState } = useVault();

    useEffect(() => {
        if (lockState === 'unlocked') {
            return;
        }
        clearMsgImageCache();
        clearMsgVideoCache();
        clearAudioCache();
    }, [lockState]);

    return null;
}

function ChatInputProvider({ children }) {
    const chatInputRef = useRef(null);

    const focusChatInput = useCallback(() => {
        const input = chatInputRef.current;
        if (!input?.focus) {
            return;
        }

        try {
            if (typeof document !== 'undefined' && document.activeElement === input) {
                return;
            }
            input.focus();
        } catch {}
    }, []);

    const value = useMemo(
        () => ({
            chatInputRef,
            focusChatInput,
        }),
        [focusChatInput]
    );

    return <ChatInputContext.Provider value={value}>{children}</ChatInputContext.Provider>;
}

function ChatProvider({ children }) {
    return (
        <SharedChatProvider>
            <ChatMediaCacheCleaner />
            <ChatInputProvider>{children}</ChatInputProvider>
        </SharedChatProvider>
    );
}

function useChatInput() {
    const context = useContext(ChatInputContext);
    if (!context) {
        throw new Error('useChatInput must be used within a ChatProvider');
    }
    return context;
}

export { ChatProvider, useChat, useChatInput };
