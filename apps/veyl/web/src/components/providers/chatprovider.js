'use client';

import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { createChat, createChatProvider } from '@glyphteck/shared/providers/chatprovider';
import { MSG_BATCH_SIZE } from '@glyphteck/shared/chat/utils';
import { db, getFunctions, getStorage } from '@/lib/firebase/firebaseclient';
import { useUser } from '@/components/providers/userprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { preloadMessageMedia } from '@/components/chat/mediapreload';
import { seedMsgImage } from '@/components/chat/usemsgimage';

const chat = createChat({
    db,
    getStorage,
    async setMediaSaved(path, stayId, saved) {
        await httpsCallable(getFunctions(), 'setMediaSaved')({ path, stayId, saved });
        return true;
    },
});

const chatWarming = {
    enabled: true,
    eagerCount: 10,
    count: 10,
    pageSize: MSG_BATCH_SIZE,
    media: {
        enabled: true,
        startDelayMs: 80,
        stepDelayMs: 40,
    },
};

const { ChatProvider: SharedChatProvider, useChat } = createChatProvider({
    chat,
    useUser,
    useVault,
    chatWarming,
    preloadMessageMedia,
    adoptLocalMessageMedia(message, local) {
        if (local?.localUri) {
            seedMsgImage(message, local.localUri, { priority: 4 });
        }
    },
});

const ChatInputContext = createContext(null);

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
