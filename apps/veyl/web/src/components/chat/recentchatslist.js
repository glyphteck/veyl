'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { formatUserDisplay, formatFullDateTime } from '@/lib/utils';
import { getMsgPreview as displayLastMsg } from '@glyphteck/shared/chat/messages';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useUser } from '@/components/providers/userprovider';
import { useChat, useChatInput } from '@/components/providers/chatprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { listNavigationStep, loopListIndex } from '@/lib/focus';

function chatShortcutIndex(event) {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) {
        return null;
    }

    const codeMatch = /^Digit([0-9])$/.exec(event.code || '');
    const digit = codeMatch ? Number(codeMatch[1]) : /^[0-9]$/.test(event.key || '') ? Number(event.key) : null;
    if (digit == null) return null;
    if (digit === 0) return 9;
    return digit - 1;
}

export function RecentChatsList() {
    const { chatPK, settings } = useUser();
    const { chats, isChatDataReady, hasMoreChats, loadingMoreChats, loadMoreChats, selectChat, selectedChatId } = useChat();
    const { focusChatInput, focusNavbar, selectedChatButtonRef } = useChatInput();
    const { peers, peerByChatPK, updatePeer, isBlockedChatPK } = usePeer();
    const bitcoin = useBitcoin();
    const { cloaked } = useCloak();
    const rowRefs = useRef([]);
    const focusedInitialChatRef = useRef(false);
    const visibleChats = useMemo(() => {
        const list = Array.isArray(chats) ? chats : [];
        return list.filter((chat) => {
            const peerChatPK = chat.participants.find((p) => p !== chatPK);
            return !isBlockedChatPK?.(peerChatPK);
        });
    }, [chatPK, chats, isBlockedChatPK]);

    const handleChatClick = useCallback(
        (chatId, { focusInput = true } = {}) => {
            if (selectedChatId !== chatId) {
                selectChat(chatId);
            }
            if (focusInput) {
                focusChatInput();
            }
        },
        [focusChatInput, selectChat, selectedChatId]
    );

    const handleScroll = useCallback(
        (event) => {
            if (!hasMoreChats || loadingMoreChats) {
                return;
            }
            const target = event.currentTarget;
            if (target.scrollTop + target.clientHeight >= target.scrollHeight - 160) {
                void loadMoreChats?.();
            }
        },
        [hasMoreChats, loadingMoreChats, loadMoreChats]
    );

    const focusChatAtIndex = useCallback(
        (index) => {
            const chat = visibleChats[index];
            if (!chat?.id) {
                return false;
            }
            const row = rowRefs.current[index];
            if (!row?.focus) {
                return false;
            }
            row.focus({ preventScroll: true });
            row.scrollIntoView?.({ block: 'nearest' });
            return true;
        },
        [visibleChats]
    );

    const stepChat = useCallback(
        (step) => {
            if (!visibleChats.length) {
                return false;
            }
            const active = typeof document === 'undefined' ? null : document.activeElement;
            const focusedIndex = rowRefs.current.slice(0, visibleChats.length).findIndex((row) => row && active && (row === active || row.contains(active)));
            const selectedIndex = visibleChats.findIndex((chat) => chat?.id === selectedChatId);
            const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex;
            const nextIndex = loopListIndex(visibleChats.length, currentIndex, step);
            if (nextIndex === focusedIndex) {
                return true;
            }
            return focusChatAtIndex(nextIndex);
        },
        [focusChatAtIndex, selectedChatId, visibleChats]
    );

    useEffect(() => {
        if (focusedInitialChatRef.current || !isChatDataReady || selectedChatId || !visibleChats.length) {
            return;
        }
        const active = document.activeElement;
        if (active && active !== document.body && active !== document.documentElement) {
            return;
        }
        focusedInitialChatRef.current = focusChatAtIndex(0);
    }, [focusChatAtIndex, isChatDataReady, selectedChatId, visibleChats.length]);

    const handleListKeyDown = useCallback(
        (event) => {
            if (!isChatDataReady) return;
            if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && focusNavbar()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const index = chatShortcutIndex(event);
            if (index != null) {
                if (focusChatAtIndex(index)) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }
            const step = listNavigationStep(event, { ignoreEditable: false });
            if (!step) return;
            if (stepChat(step)) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
        [focusChatAtIndex, focusNavbar, isChatDataReady, stepChat]
    );

    if (!isChatDataReady) return;
    return (
        <Card>
            <div className="overflow-y-auto" onKeyDown={handleListKeyDown} onScroll={handleScroll}>
                <div className={`divide-y ${visibleChats.length < 12 ? 'border-b' : ''}`}>
                    {visibleChats.map((chat, index) => {
                        const peerChatPK = chat.participants.find((p) => p !== chatPK);
                        const profile = peerByChatPK.get(peerChatPK) ?? null;
                        const displayName = formatUserDisplay({
                            username: profile?.username,
                            chatPK: peerChatPK,
                        });

                        return (
                            <Button
                                key={chat.id}
                                ref={(node) => {
                                    rowRefs.current[index] = node;
                                    if (chat.id === selectedChatId) {
                                        selectedChatButtonRef.current = node;
                                    } else if (selectedChatButtonRef.current === node) {
                                        selectedChatButtonRef.current = null;
                                    }
                                }}
                                type="button"
                                tabIndex={index === 0 ? 0 : -1}
                                className={`group h-15 w-full justify-start rounded-none px-3 text-left first:pt-px last:pb-px ${chat.id === selectedChatId ? 'bg-foreground/5' : ''}`}
                                onClick={() => {
                                    if (selectedChatId !== chat.id && profile?.uid) {
                                        updatePeer(profile.uid, { refreshAvatar: true });
                                    }
                                    handleChatClick(chat.id);
                                }}
                            >
                                <div className="flex w-full items-center gap-2.5">
                                    <Avatar active={profile?.active} bot={!!profile?.bot} className="grower group-focus-visible:scale-120">
                                        <AvatarImage src={profile?.avatar} alt={displayName} />
                                        <AvatarFallback />
                                    </Avatar>
                                    <div className="hidden min-w-0 flex-1 md:block">
                                        <div className="flex items-baseline justify-between gap-3">
                                            <span className="min-w-0 flex-1 truncate font-black leading-5">{displayName}</span>
                                            <span className="shrink-0 whitespace-nowrap text-sm leading-4 font-black text-muted">{chat.ts ? formatFullDateTime(chat.ts) : ''}</span>
                                        </div>
                                        <div className={`mt-0.5 truncate text-sm leading-4 ${chat.unseen ? 'text-foreground' : 'text-muted'} ${cloaked ? 'cloaked' : ''}`}>
                                            {displayLastMsg(chat.lastMsg, chatPK, settings, bitcoin.price)}
                                        </div>
                                    </div>
                                </div>
                            </Button>
                        );
                    })}
                </div>
                {loadingMoreChats ? <div className="py-3 text-center text-sm font-bold text-muted">loading...</div> : null}
            </div>
        </Card>
    );
}
