'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { WEB_CHAT_WARMING } from '@veyl/shared/chat/messages/session/config';
import { createChat, createChatProvider } from '@veyl/shared/providers/chatprovider';
import { db, getFunctions, getStorage } from '@/lib/firebase/firebaseclient';
import { useUser } from '@/components/providers/userprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { clearAudioCache } from '@/lib/chat/audiocache';
import { preloadMessageMedia } from '@/lib/chat/preload';
import { clearMsgImageCache, seedMsgImage } from '@/lib/chat/useimage';
import { clearMsgVideoCache } from '@/lib/chat/videocache';
import { mark } from '@/lib/diagnostics';

const chat = createChat({
    db,
    getStorage,
    async setMediaSaved(path, stayId, stayKey, saved) {
        await httpsCallable(getFunctions(), 'setMediaSaved')({ path, stayId, stayKey, saved });
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
    diag: mark,
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
    const attachmentButtonRef = useRef(null);
    const moneyButtonRef = useRef(null);
    const peerHeaderRef = useRef(null);
    const selectedChatButtonRef = useRef(null);
    const navbarRef = useRef(null);

    const focusElement = useCallback((element) => {
        if (!element?.focus) {
            return false;
        }

        try {
            element.focus({ preventScroll: true });
            return true;
        } catch {
            try {
                element.focus();
                return true;
            } catch {
                return false;
            }
        }
    }, []);

    const focusChatInput = useCallback(() => {
        const input = chatInputRef.current;
        if (!input?.focus) {
            return false;
        }

        try {
            if (typeof document !== 'undefined' && document.activeElement === input) {
                return true;
            }
            return focusElement(input);
        } catch {
            return false;
        }
    }, [focusElement]);

    const focusSelectedChat = useCallback(() => focusElement(selectedChatButtonRef.current), [focusElement]);
    const focusNavbar = useCallback(() => focusElement(navbarRef.current), [focusElement]);

    const value = useMemo(
        () => ({
            chatInputRef,
            attachmentButtonRef,
            moneyButtonRef,
            peerHeaderRef,
            selectedChatButtonRef,
            navbarRef,
            focusChatInput,
            focusSelectedChat,
            focusNavbar,
        }),
        [focusChatInput, focusNavbar, focusSelectedChat]
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
