'use client';
import { Card } from '@/components/card';
import { Button } from '@/components/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { ChatInput } from './chatinput';
import { Messages } from './messages/list';
import { useChat, useChatInput } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { formatUserDisplay } from '@veyl/shared/profile';
import { renderMoney } from '@veyl/shared/money';
import { chatUploadErrorMessage, queueMessages } from '@/lib/chat/files';
import { canReplyToMsg, makeReq, makeTxt, setReply, setTxt } from '@veyl/shared/chat/messages';
import { parseCommandAmountSats } from '@veyl/shared/commands';
import { toast } from 'sonner';
import { useCallback, useEffect, useRef, useState } from 'react';

function canFocusControl(element) {
    return !!element && typeof element.focus === 'function' && !element.disabled;
}

function focusControl(element) {
    if (!canFocusControl(element)) {
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
}

export function Chatbox() {
    const { chats, selectedChatId, sendMessage, sendAttachment, updateMessage } = useChat();
    const { attachmentButtonRef, chatInputRef, focusChatInput, focusSelectedChat, moneyButtonRef, peerHeaderRef, setPaymentPeer } = useChatInput();
    const { chatPK, chatBanned, settings } = useUser();
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark } = useWallet();
    const { peerByChatPK, primePeer, updatePeer } = usePeer();
    const { openDialog } = useDialog();
    const dragDepthRef = useRef(0);
    const [isDragOver, setIsDragOver] = useState(false);
    const [draft, setDraft] = useState(null);
    const [inputH, setInputH] = useState(96);
    const currentChat = chats?.find((chat) => chat.id === selectedChatId) ?? null;
    const peerChatPK = currentChat?.peerChatPK || null;
    const peerProfile = peerByChatPK.get(peerChatPK) ?? null;
    const peerDisplayName = formatUserDisplay({
        username: peerProfile?.username,
        chatPK: peerChatPK,
    });

    // Auto-focus input when chat is selected
    useEffect(() => {
        if (selectedChatId) {
            focusChatInput();
        }
    }, [selectedChatId, focusChatInput]);

    // Best-effort: refresh peer's volatile fields on direct interaction.
    useEffect(() => {
        if (peerProfile?.uid) {
            updatePeer(peerProfile.uid);
            return;
        }
        if (currentChat?.peerUid && peerChatPK) {
            void primePeer({ uid: currentChat.peerUid, chatPK: peerChatPK });
        }
    }, [currentChat?.peerUid, peerChatPK, peerProfile?.uid, primePeer, selectedChatId, updatePeer]);

    useEffect(() => {
        setDraft(null);
    }, [selectedChatId]);

    useEffect(() => {
        setPaymentPeer(selectedChatId && peerProfile?.walletPK ? peerProfile : null);
    }, [peerProfile, selectedChatId, setPaymentPeer]);

    useEffect(() => () => setPaymentPeer(null), [setPaymentPeer]);

    const handleSendMessage = async (messageContent, draftState) => {
        try {
            const base = makeTxt(messageContent);
            const canReply = draftState?.mode === 'reply' && canReplyToMsg(draftState?.msg);
            const replyId = String(
                canReply
                    ? (typeof draftState?.msg?.id === 'string' && !draftState.msg.id.startsWith('local:') ? draftState.msg.id : draftState?.msg?.cid) || ''
                    : ''
            ).trim();
            const msg = replyId ? setReply(base, replyId) : base;
            await sendMessage(peerChatPK, msg);
        } catch {}
    };

    const handleEditMessage = useCallback(
        async (msg, text) => {
            if (!selectedChatId || !peerChatPK || !msg?.id || msg?.t !== 'txt') {
                return;
            }
            const next = setTxt(msg, text);
            await updateMessage(selectedChatId, msg.id, next, peerChatPK);
        },
        [peerChatPK, selectedChatId, updateMessage]
    );

    const handleSendAttachments = useCallback(
        async (files) => {
            if (!peerChatPK) {
                return;
            }

            try {
                await queueMessages(files, (attachment) => sendAttachment(peerChatPK, attachment));
            } catch (error) {
                toast.error(chatUploadErrorMessage(error));
            }
        },
        [peerChatPK, sendAttachment]
    );

    const handleOpenMoney = useCallback((tab = 'send', amount = null) => {
        if (!peerProfile?.walletPK) {
            return;
        }
        openDialog('payments', {
            tab,
            peer: peerProfile,
            amount,
        });
    }, [openDialog, peerProfile]);

    const handleCommand = useCallback(
        async (command) => {
            if (!command?.complete) {
                return;
            }
            const amountSats = parseCommandAmountSats(command.args.amount);
            if (!amountSats) {
                toast.error('invalid amount');
                return;
            }
            if (command.name === 'send') {
                if (!peerProfile?.walletPK) {
                    toast.error('this person cannot receive money yet');
                    return;
                }
                const moneyFormat = settings?.moneyFormat || 'sats';
                const formattedAmount = renderMoney(amountSats, moneyFormat, bitcoin?.price);
                const loadingToastId = toast(`sending ${formattedAmount} to ${peerDisplayName}`, { duration: Infinity });
                try {
                    await sendMoneyWithSpark(peerProfile.walletPK, amountSats);
                    toast.success(`sent ${formattedAmount} to ${peerDisplayName}`, { id: loadingToastId, duration: 2000 });
                } catch (error) {
                    toast.error(error?.message || 'failed to send money', { id: loadingToastId, duration: 2000 });
                }
                return;
            }
            if (command.name === 'request') {
                if (chatBanned) {
                    toast.error('chat unavailable');
                    return;
                }
                if (!peerChatPK) {
                    toast.error('this person cannot receive requests yet');
                    return;
                }
                try {
                    await sendMessage(peerChatPK, makeReq(amountSats));
                    toast(`requested ${renderMoney(amountSats, settings?.moneyFormat || 'sats', bitcoin?.price)} from ${peerDisplayName}`);
                } catch (error) {
                    console.error('chat request command failed', error);
                    toast.error(error?.message || 'failed to send request');
                }
            }
        },
        [bitcoin?.price, chatBanned, peerChatPK, peerDisplayName, peerProfile?.walletPK, sendMessage, sendMoneyWithSpark, settings?.moneyFormat]
    );

    const handleReply = useCallback(
        (msg) => {
            if (!canReplyToMsg(msg)) {
                return;
            }
            setDraft({ mode: 'reply', msg });
            focusChatInput();
        },
        [focusChatInput]
    );

    const handleEdit = useCallback(
        (msg) => {
            setDraft({ mode: 'edit', msg });
            focusChatInput();
        },
        [focusChatInput]
    );

    const handleClearDraft = useCallback(() => {
        setDraft(null);
    }, []);

    const handleChatKeyDown = useCallback(
        (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }

            if (event.key === 'Escape') {
                if (focusSelectedChat()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const controls = [chatInputRef.current, attachmentButtonRef.current, moneyButtonRef.current, peerHeaderRef.current].filter(canFocusControl);
            if (!controls.length || typeof document === 'undefined') {
                return;
            }

            const activeIndex = controls.findIndex((control) => control === document.activeElement);
            if (activeIndex < 0) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? -1 : 1;
            const next = controls[(activeIndex + step + controls.length) % controls.length];
            focusControl(next);
        },
        [attachmentButtonRef, chatInputRef, focusSelectedChat, moneyButtonRef, peerHeaderRef]
    );

    const hasDraggedFiles = (event) => {
        const types = event?.dataTransfer?.types;
        return Array.isArray(types) ? types.includes('Files') : types?.contains?.('Files');
    };

    const resetDragState = useCallback(() => {
        dragDepthRef.current = 0;
        setIsDragOver(false);
    }, []);

    const handleDragEnter = useCallback((event) => {
        if (!hasDraggedFiles(event)) {
            return;
        }
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDragOver(true);
    }, []);

    const handleDragOver = useCallback((event) => {
        if (!hasDraggedFiles(event)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDragLeave = useCallback((event) => {
        if (!hasDraggedFiles(event)) {
            return;
        }
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
            setIsDragOver(false);
        }
    }, []);

    const handleDrop = useCallback(
        async (event) => {
            if (!hasDraggedFiles(event)) {
                return;
            }

            event.preventDefault();
            resetDragState();

            const files = Array.from(event.dataTransfer?.files || []).filter(Boolean);
            if (!files.length) {
                return;
            }

            await handleSendAttachments(files);
        },
        [handleSendAttachments, resetDragState]
    );

    if (!selectedChatId) {
        return (
            <Card className="h-full flex flex-col">
                <div className="flex flex-1 items-center justify-center p-6">
                    <p className="text-2xl text-muted">Select a chat.</p>
                </div>
            </Card>
        );
    }

    return (
        <Card className="h-full flex flex-col relative" onClick={() => focusChatInput()} onKeyDown={handleChatKeyDown} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            {/* top fadeout */}
            <div className="absolute left-0 right-0 z-20 bg-linear-to-t from-transparent to-background h-24 pointer-events-none" />
            {isDragOver ? (
                <div className="absolute inset-0 z-40 pointer-events-none rounded-round border-2 border-dashed border-foreground/30 bg-foreground/5 backdrop-blur-sm">
                    <div className="flex h-full items-center justify-center px-8 text-center">
                        <p className="text-xl font-black">drop files to send</p>
                    </div>
                </div>
            ) : null}
            {/* peer ref */}
            <div className="absolute left-0 right-0 z-25 pt-3 pb-8 mx-2">
                <div className="flex items-center gap-2 px-3">
                    <div className="flex min-w-0 flex-1 justify-center">
                        <Button
                            ref={peerHeaderRef}
                            className="group min-w-0"
                            onClick={() => {
                                if (peerProfile) {
                                    openDialog('userdetails', { user: peerProfile });
                                }
                            }}
                        >
                            <Avatar active={peerProfile?.active} bot={!!peerProfile?.bot} className="pointer-events-auto grower size-11 group-focus-visible:scale-120">
                                <AvatarImage src={peerProfile?.avatar} alt={peerDisplayName} />
                                <AvatarFallback />
                            </Avatar>
                            <div className="min-w-0 text-xl font-black pointer-events-auto truncate">{peerDisplayName}</div>
                        </Button>
                    </div>
                </div>
            </div>
            {/* Messages */}
            <div className="flex-1 min-h-0">
                <Messages onReply={handleReply} onEdit={handleEdit} bottomPad={inputH} />
            </div>
            <ChatInput
                inputRef={chatInputRef}
                attachmentButtonRef={attachmentButtonRef}
                moneyButtonRef={moneyButtonRef}
                onSendMessage={handleSendMessage}
                onEditMessage={handleEditMessage}
                onSendAttachments={handleSendAttachments}
                onSendMoney={peerProfile?.walletPK ? () => handleOpenMoney('send') : undefined}
                onCommand={handleCommand}
                onHeightChange={setInputH}
                draft={draft}
                onClearDraft={handleClearDraft}
                onEscape={focusSelectedChat}
                hidden={!selectedChatId || !currentChat}
            />
        </Card>
    );
}
