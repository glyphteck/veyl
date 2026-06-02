'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { formatUserDisplay } from '@veyl/shared/profile';
import { formatFullDateTime } from '@veyl/shared/utils/time';
import { getMsgPreview as displayLastMsg } from '@veyl/shared/chat/messages';
import { getChatPeerPK } from '@veyl/shared/chat/ids';
import { getMovedRowBatch, sameListIds } from '@veyl/shared/chat/listanimation';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useUser } from '@/components/providers/userprovider';
import { useChat, useChatInput } from '@/components/providers/chatprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { listNavigationStep, loopListIndex } from '@/lib/focus';

const CHAT_ROW_APPEAR_MS = 640;
const CHAT_ROW_PHASE_MS = CHAT_ROW_APPEAR_MS / 2;
const CHAT_ROW_APPEAR_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

function getChatIds(chats) {
    return (chats || []).map((chat) => chat?.id).filter(Boolean);
}

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

const RecentChatAvatar = memo(function RecentChatAvatar({ active, alt, bot, src }) {
    return (
        <Avatar active={active} bot={bot} className="grower group-focus-visible:scale-120">
            <AvatarImage src={src} alt={alt} />
            <AvatarFallback />
        </Avatar>
    );
});

function samePreviewMsg(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
        a.cid === b.cid &&
        a.id === b.id &&
        a.t === b.t &&
        a.c === b.c &&
        a.sys === b.sys &&
        a.retention === b.retention &&
        a.pending === b.pending &&
        a.failed === b.failed
    );
}

function sameChatRow(prevChat, nextChat) {
    if (prevChat === nextChat) return true;
    if (!prevChat || !nextChat) return false;
    return (
        prevChat.id === nextChat.id &&
        prevChat.ts === nextChat.ts &&
        prevChat.unseen === nextChat.unseen &&
        prevChat.settings?.retention === nextChat.settings?.retention &&
        samePreviewMsg(prevChat.lastMsg, nextChat.lastMsg)
    );
}

function samePeerProfile(prevProps, nextProps) {
    const prevPeerChatPK = getChatPeerPK(prevProps.chat, prevProps.chatPK);
    const nextPeerChatPK = getChatPeerPK(nextProps.chat, nextProps.chatPK);
    if (prevPeerChatPK !== nextPeerChatPK) {
        return false;
    }
    const prevProfile = prevPeerChatPK ? prevProps.peerByChatPK?.get(prevPeerChatPK) : null;
    const nextProfile = nextPeerChatPK ? nextProps.peerByChatPK?.get(nextPeerChatPK) : null;
    return (
        prevProfile?.uid === nextProfile?.uid &&
        prevProfile?.username === nextProfile?.username &&
        prevProfile?.avatar === nextProfile?.avatar &&
        prevProfile?.active === nextProfile?.active &&
        prevProfile?.bot === nextProfile?.bot
    );
}

const RecentChatRow = memo(function RecentChatRow({
    bitcoinPrice,
    chat,
    chatPK,
    cloaked,
    handleChatClick,
    interactive = true,
    isFirst,
    isLast,
    mode = null,
    peerByChatPK,
    rowRefs,
    selected,
    selectedChatButtonRef,
    settings,
    updatePeer,
}) {
    const peerChatPK = getChatPeerPK(chat, chatPK);
    const profile = peerByChatPK.get(peerChatPK) ?? null;
    const displayName = formatUserDisplay({
        username: profile?.username,
        chatPK: peerChatPK,
    });

    return (
        <div className={`recent-chat-row-stable ${isLast ? 'recent-chat-row-last' : ''} ${mode ? `recent-chat-row-${mode}` : ''}`}>
            <div className={mode ? 'recent-chat-row-content' : ''}>
                <Button
                    ref={(node) => {
                        if (!interactive || !node) {
                            const current = rowRefs.current.get(chat.id);
                            if (!node || current === node) {
                                rowRefs.current.delete(chat.id);
                            }
                            if (selectedChatButtonRef.current === node || selectedChatButtonRef.current === current) {
                                selectedChatButtonRef.current = null;
                            }
                            return;
                        }
                        rowRefs.current.set(chat.id, node);
                        if (selected) {
                            selectedChatButtonRef.current = node;
                        } else if (selectedChatButtonRef.current === node) {
                            selectedChatButtonRef.current = null;
                        }
                    }}
                    type="button"
                    tabIndex={interactive && isFirst ? 0 : -1}
                    className={`group h-15 w-full justify-start rounded-none px-3 text-left ${isFirst ? 'pt-px' : ''} ${isLast ? 'pb-px' : ''} ${selected ? 'bg-foreground/5' : ''}`}
                    onClick={
                        interactive
                            ? () => {
                                  if (!selected && profile?.uid) {
                                      updatePeer(profile.uid, { refreshAvatar: true });
                                  }
                                  handleChatClick(chat.id);
                              }
                            : undefined
                    }
                >
                    <div className="flex w-full items-center gap-2.5">
                        <RecentChatAvatar active={!!profile?.active} bot={!!profile?.bot} src={profile?.avatar} alt={displayName} />
                        <div className="hidden min-w-0 flex-1 md:block">
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="min-w-0 flex-1 truncate font-black leading-5">{displayName}</span>
                                <span className="shrink-0 whitespace-nowrap text-sm leading-4 font-black text-muted">{chat.ts ? formatFullDateTime(chat.ts) : ''}</span>
                            </div>
                            <div className={`mt-0.5 truncate text-sm leading-4 ${chat.unseen ? 'text-foreground' : 'text-muted'} ${cloaked ? 'cloaked' : ''}`}>
                                {displayLastMsg(chat.lastMsg, chatPK, settings, bitcoinPrice)}
                            </div>
                        </div>
                    </div>
                </Button>
            </div>
        </div>
    );
}, (prev, next) => (
    prev.bitcoinPrice === next.bitcoinPrice &&
    prev.chatPK === next.chatPK &&
    prev.cloaked === next.cloaked &&
    prev.interactive === next.interactive &&
    prev.isFirst === next.isFirst &&
    prev.isLast === next.isLast &&
    prev.mode === next.mode &&
    prev.selected === next.selected &&
    prev.settings === next.settings &&
    sameChatRow(prev.chat, next.chat) &&
    samePeerProfile(prev, next)
));

export function RecentChatsList() {
    const { chatPK, settings } = useUser();
    const { chats, isChatDataReady, hasMoreChats, loadingMoreChats, loadMoreChats, selectChat, selectedChatId } = useChat();
    const { focusChatInput, focusNavbar, selectedChatButtonRef } = useChatInput();
    const { peerByChatPK, updatePeer, isBlockedChatPK } = usePeer();
    const bitcoin = useBitcoin();
    const { cloaked } = useCloak();
    const rowRefs = useRef(new Map());
    const stableRowsRef = useRef([]);
    const pendingRowsRef = useRef(null);
    const rowMoveRef = useRef(null);
    const rowMoveKeyRef = useRef(0);
    const focusedInitialChatRef = useRef(false);
    const [rowMove, setRowMove] = useState(null);
    const visibleChats = useMemo(() => {
        const list = Array.isArray(chats) ? chats : [];
        return list.filter((chat) => {
            const peerChatPK = getChatPeerPK(chat, chatPK);
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
            const row = rowRefs.current.get(chat.id);
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
            const focusedIndex = visibleChats.findIndex((chat) => {
                const row = rowRefs.current.get(chat?.id);
                return row && active && (row === active || row.contains(active));
            });
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

    const createRowMove = useCallback((previousRows, nextRows) => {
        const batch = getMovedRowBatch(getChatIds(previousRows), getChatIds(nextRows));
        if (!batch) {
            return null;
        }
        rowMoveKeyRef.current += 1;
        return {
            ...batch,
            key: `${rowMoveKeyRef.current}:${batch.ids.join(',')}`,
            phase: 'leaving',
            previousRows,
            nextRows,
        };
    }, []);

    useLayoutEffect(() => {
        if (!isChatDataReady) {
            stableRowsRef.current = [];
            pendingRowsRef.current = null;
            rowMoveRef.current = null;
            setRowMove(null);
            return;
        }

        if (rowMoveRef.current) {
            pendingRowsRef.current = visibleChats;
            return;
        }

        const previousRows = stableRowsRef.current;
        const move = createRowMove(previousRows, visibleChats);
        if (!move) {
            stableRowsRef.current = visibleChats;
            pendingRowsRef.current = null;
            setRowMove(null);
            return;
        }

        rowMoveRef.current = move;
        pendingRowsRef.current = null;
        setRowMove(move);
    }, [createRowMove, isChatDataReady, visibleChats]);

    useEffect(() => {
        if (!rowMove) {
            return;
        }

        const timeout = setTimeout(() => {
            setRowMove((current) => {
                if (current?.key !== rowMove.key) {
                    return current;
                }
                if (current.phase === 'leaving') {
                    const entering = { ...current, phase: 'entering' };
                    rowMoveRef.current = entering;
                    return entering;
                }

                const pendingRows = pendingRowsRef.current;
                pendingRowsRef.current = null;
                stableRowsRef.current = current.nextRows;

                if (pendingRows && !sameListIds(getChatIds(current.nextRows), getChatIds(pendingRows))) {
                    const nextMove = createRowMove(current.nextRows, pendingRows);
                    if (nextMove) {
                        rowMoveRef.current = nextMove;
                        return nextMove;
                    }
                }

                if (pendingRows) {
                    stableRowsRef.current = pendingRows;
                }
                rowMoveRef.current = null;
                return null;
            });
        }, CHAT_ROW_PHASE_MS);

        return () => {
            clearTimeout(timeout);
        };
    }, [createRowMove, rowMove]);

    const movingIds = useMemo(() => new Set(rowMove ? rowMove.ids : []), [rowMove]);
    const displayedChats = rowMove?.phase === 'leaving' ? rowMove.previousRows : rowMove?.phase === 'entering' ? rowMove.nextRows : visibleChats;

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
            <style>{`
                .recent-chat-row-stable {
                    contain: layout paint;
                    overflow: hidden;
                    position: relative;
                }
                .recent-chat-row-stable::after {
                    content: '';
                    position: absolute;
                    inset-inline: 0;
                    bottom: 0;
                    height: 1px;
                    background: var(--border);
                    pointer-events: none;
                }
                .recent-chat-row-last::after,
                .recent-chat-row-leaving::after {
                    opacity: 0;
                }
                .recent-chat-row-leaving,
                .recent-chat-row-entering {
                    height: 60px;
                }
                .recent-chat-row-content {
                    transform-origin: center top;
                    will-change: opacity, transform;
                }
                .recent-chat-row-leaving {
                    will-change: height;
                    animation: recent-chat-row-slot-out ${CHAT_ROW_PHASE_MS}ms ${CHAT_ROW_APPEAR_EASE} both;
                }
                .recent-chat-row-entering {
                    will-change: height;
                    animation: recent-chat-row-slot-in ${CHAT_ROW_PHASE_MS}ms ${CHAT_ROW_APPEAR_EASE} both;
                }
                .recent-chat-row-leaving > .recent-chat-row-content {
                    animation: recent-chat-row-content-out ${CHAT_ROW_PHASE_MS}ms ${CHAT_ROW_APPEAR_EASE} both;
                }
                .recent-chat-row-entering > .recent-chat-row-content {
                    animation: recent-chat-row-content-in ${CHAT_ROW_PHASE_MS}ms ${CHAT_ROW_APPEAR_EASE} both;
                }
                @keyframes recent-chat-row-slot-out {
                    0%, 50% { height: 60px; }
                    100% { height: 0; }
                }
                @keyframes recent-chat-row-slot-in {
                    0% { height: 0; }
                    50%, 100% { height: 60px; }
                }
                @keyframes recent-chat-row-content-in {
                    0%, 50% { opacity: 0; transform: scale(0.98); }
                    100% { opacity: 1; transform: scale(1); }
                }
                @keyframes recent-chat-row-content-out {
                    0% { opacity: 1; transform: scale(1); }
                    50%, 100% { opacity: 0; transform: scale(0.98); }
                }
            `}</style>
            <div className="overflow-y-auto" onKeyDown={handleListKeyDown} onScroll={handleScroll}>
                <div className={visibleChats.length < 12 ? 'border-b' : ''}>
                    {displayedChats.map((chat, index) =>
                        <RecentChatRow
                            key={chat.id}
                            bitcoinPrice={bitcoin.price}
                            chat={chat}
                            chatPK={chatPK}
                            cloaked={cloaked}
                            handleChatClick={handleChatClick}
                            interactive={!(rowMove?.phase === 'leaving' && movingIds.has(chat.id))}
                            isFirst={index === 0}
                            isLast={index === displayedChats.length - 1}
                            mode={movingIds.has(chat.id) ? rowMove?.phase : null}
                            peerByChatPK={peerByChatPK}
                            rowRefs={rowRefs}
                            selected={chat.id === selectedChatId}
                            selectedChatButtonRef={selectedChatButtonRef}
                            settings={settings}
                            updatePeer={updatePeer}
                        />
                    )}
                </div>
                {loadingMoreChats ? <div className="py-3 text-center text-sm font-bold text-muted">loading...</div> : null}
            </div>
        </Card>
    );
}
