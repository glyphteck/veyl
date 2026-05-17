'use client';
import { Card } from '@/components/card';
import { Button } from '@/components/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { ChatInput } from './chatinput';
import { MessageList } from './messagelist';
import { useChat, useChatInput } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { formatUserDisplay, renderMoney } from '@/lib/utils';
import { prepareChatFile } from '@/lib/chatfiles';
import { getPeerChatPKFromChatId } from '@glyphteck/shared/chat/utils';
import { canReplyToMsg, makeReq, makeTxt, setReply, setTxt } from '@glyphteck/shared/chat/messages';
import { parseCommandAmountSats } from '@glyphteck/shared/commands';
import { CHAT_FILE_SIZE_LIMIT_ENABLED, MAX_CHAT_FILE_BYTES } from '@glyphteck/shared/chat/filepayload';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

function formatMaxSize(bytes) {
    const mb = bytes / (1024 * 1024);
    return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

export function Chatbox() {
    const { chats, selectedChatId, sendMessage, sendAttachment, updateMessage } = useChat();
    const { focusChatInput, chatInputRef } = useChatInput();
    const { chatPK, chatBanned, settings } = useUser();
    const { sendMoneyWithSpark, bitcoin } = useWallet();
    const { peers, updatePeer } = usePeer();
    const { openDialog } = useDialog();
    const dragDepthRef = useRef(0);
    const [isDragOver, setIsDragOver] = useState(false);
    const [draft, setDraft] = useState(null);
    const [inputH, setInputH] = useState(96);
    const currentChat = chats?.find((chat) => chat.id === selectedChatId) ?? null;
    const peerChatPK = getPeerChatPKFromChatId(selectedChatId, chatPK);
    const peerProfile = peers?.find((peer) => peer.chatPK === peerChatPK) ?? null;
    const peerDisplayName = formatUserDisplay({
        username: peerProfile?.username,
        walletPK: peerChatPK,
    });

    // Auto-focus input when chat is selected
    useEffect(() => {
        if (selectedChatId) {
            focusChatInput();
        }
    }, [selectedChatId, focusChatInput]);

    // Best-effort: refresh peer's volatile fields and avatar on direct interaction.
    useEffect(() => {
        if (peerProfile?.uid) {
            updatePeer(peerProfile.uid, { refreshAvatar: true });
        }
    }, [selectedChatId, peerProfile?.uid, updatePeer]);

    useEffect(() => {
        setDraft(null);
    }, [selectedChatId]);

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
        } catch (error) {
            console.error('Failed to send message:', error);
        }
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

    const handleSendAttachment = useCallback(
        async (file) => {
            if (!file || !peerChatPK) {
                return;
            }

            if (CHAT_FILE_SIZE_LIMIT_ENABLED && Number.isFinite(file?.size) && file.size > MAX_CHAT_FILE_BYTES) {
                toast.error(`attachment too large (max ${formatMaxSize(MAX_CHAT_FILE_BYTES)})`);
                return;
            }

            try {
                await sendAttachment(peerChatPK, await prepareChatFile(file));
            } catch (error) {
                if (error?.code === 'file-too-large') {
                    toast.error(`attachment too large (max ${formatMaxSize(MAX_CHAT_FILE_BYTES)})`);
                    return;
                }
                console.error('Failed to send attachment:', error);
                toast.error(error?.message || 'failed to send attachment');
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
                    toast.error('missing wallet key');
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
                    toast.error('missing chat key');
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

    const handleOpenDeleteChat = useCallback(
        (event) => {
            event.stopPropagation();
            if (!selectedChatId) {
                return;
            }
            openDialog('deletechat', { chatId: selectedChatId });
        },
        [openDialog, selectedChatId]
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

            for (const file of files) {
                await handleSendAttachment(file);
            }
        },
        [handleSendAttachment, resetDragState]
    );

    if (!selectedChatId) {
        return (
            <Card className="h-full border flex flex-col">
                <div className="flex flex-1 items-center justify-center p-6">
                    <p className="text-2xl text-muted">Select a chat.</p>
                </div>
            </Card>
        );
    }

    return (
        <Card className="h-full flex flex-col relative" onClick={() => focusChatInput()} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
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
                    {currentChat ? (
                        <button type="button" className="grower-lg rounded-full p-2 text-destructive" title="delete chat" onClick={handleOpenDeleteChat}>
                            <Trash2 className="size-5" />
                        </button>
                    ) : null}
                    <div className="flex min-w-0 flex-1 justify-center">
                        <Button
                            className="group min-w-0"
                            onClick={() => {
                                if (peerProfile) {
                                    openDialog('userdetails', { user: peerProfile });
                                }
                            }}
                        >
                            <Avatar active={peerProfile?.active} bot={!!peerProfile?.bot} className="pointer-events-auto grower size-11 ">
                                <AvatarImage src={peerProfile?.avatar} alt={peerDisplayName} />
                                <AvatarFallback />
                            </Avatar>
                            <div className="min-w-0 text-xl font-black pointer-events-auto truncate">{peerDisplayName}</div>
                        </Button>
                    </div>
                    {currentChat ? <div className="size-9 shrink-0" aria-hidden="true" /> : null}
                </div>
            </div>
            {/* Messages */}
            <div className="flex-1 min-h-0">
                <MessageList onReply={handleReply} onEdit={handleEdit} bottomPad={inputH} />
            </div>
            <ChatInput
                inputRef={chatInputRef}
                onSendMessage={handleSendMessage}
                onEditMessage={handleEditMessage}
                onSendAttachment={handleSendAttachment}
                onSendMoney={peerProfile?.walletPK ? () => handleOpenMoney('send') : undefined}
                onCommand={handleCommand}
                onHeightChange={setInputH}
                draft={draft}
                onClearDraft={handleClearDraft}
                hidden={!selectedChatId || !currentChat}
            />
            {/* bottom fadeout */}
            <div className="absolute bottom-0 left-0 right-0 z-20 bg-linear-to-b from-transparent to-background h-24  pointer-events-none"></div>
        </Card>
    );
}
