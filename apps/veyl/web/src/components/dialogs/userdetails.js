'use client';

import { Card } from '@/components/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/togglegroup';
import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { makeTxt } from '@glyphteck/shared/chat/messages';
import { CHAT_RETENTION_24H, CHAT_RETENTION_SEEN, cleanChatRetention } from '@glyphteck/shared/chat/ttl';
import { usePeer } from '@/components/providers/peerprovider';
import { formatUserDisplay } from '@/lib/utils';
import { prepareChatFile } from '@/lib/chatfiles';
import { getFunctions } from '@/lib/firebase/firebaseclient';
import { HandCoins, Copy, CircleArrowRight, CircleCheck, Clock3, Eye, Flag, Paperclip, Trash2, UserX } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { getPeerChatPKFromChatId } from '@glyphteck/shared/chat/utils';

const RETENTION_OPTIONS = [
    {
        value: CHAT_RETENTION_SEEN,
        icon: Eye,
    },
    {
        value: CHAT_RETENTION_24H,
        label: '24h',
    },
];

export default function UserDetails({ data, close }) {
    const { uid, chatPK, chatBanned, blockPeer, isBlocked } = useUser();
    const { chats, sendMessage, sendAttachment, selectedChatId, dropChat, setChatTtl, startDeleteChat, finishDeleteChat, restoreDeletedChat } = useChat();
    const { openDialog } = useDialog();
    const { cloaked } = useCloak();
    const { peers, updatePeer, dropPeer } = usePeer();
    const [msgContent, setMsgContent] = useState('');
    const messageInputRef = useRef(null);
    const fileRef = useRef(null);
    const userFromData = data?.user;
    const user = useMemo(() => {
        const next = peers?.find((p) => p.uid === userFromData?.uid) ?? null;
        return next || userFromData;
    }, [peers, userFromData?.uid]);
    const isOwnProfile = user?.uid === uid;
    const blocked = isBlocked?.(user);
    const peerChatPK = user?.chatPK || '';
    const liveChat = useMemo(() => {
        if (!user?.chatPK || !chatPK) return null;
        return chats?.find((item) => getPeerChatPKFromChatId(item.id, chatPK) === user.chatPK) ?? null;
    }, [chatPK, chats, user?.chatPK]);
    const chatScopeRef = useRef({ data: null, peerChatPK: '', chatId: null });
    if (chatScopeRef.current.data !== data || chatScopeRef.current.peerChatPK !== peerChatPK) {
        chatScopeRef.current = { data, peerChatPK, chatId: liveChat?.id ?? null };
    }
    const chatId = chatScopeRef.current.chatId;
    const chat = useMemo(() => (chatId ? (chats?.find((item) => item.id === chatId) ?? liveChat) : null), [chatId, chats, liveChat]);
    const currentRetention = cleanChatRetention(chat?.settings?.retention);
    const serverRetentionRef = useRef(currentRetention);
    const pendingRetentionRef = useRef(currentRetention);
    const retentionChangedRef = useRef(false);
    const savingRetentionRef = useRef(null);
    const lastChatIdRef = useRef(chatId);
    const chatIdRef = useRef(chatId);
    const savePendingRetentionRef = useRef(null);
    const openRef = useRef(true);
    const form = useForm({
        defaultValues: {
            retention: currentRetention,
        },
    });

    useEffect(() => {
        if (isOwnProfile) {
            openDialog('settings');
        }
    }, [isOwnProfile, openDialog]);

    useEffect(() => {
        if (user?.uid && user.uid !== uid) {
            updatePeer(user.uid, { refreshAvatar: true });
        }
    }, [user?.uid, uid, updatePeer]);

    useEffect(() => {
        const chatChanged = lastChatIdRef.current !== chatId;
        lastChatIdRef.current = chatId;
        chatIdRef.current = chatId;
        serverRetentionRef.current = currentRetention;

        if (chatChanged || !retentionChangedRef.current) {
            pendingRetentionRef.current = currentRetention;
            retentionChangedRef.current = false;
            form.reset({ retention: currentRetention });
        }
    }, [chatId, currentRetention, form]);

    const discardPendingRetention = useCallback(() => {
        pendingRetentionRef.current = serverRetentionRef.current;
        retentionChangedRef.current = false;
        form.setValue('retention', serverRetentionRef.current);
    }, [form]);

    const savePendingRetention = useCallback(async () => {
        const nextRetention = cleanChatRetention(pendingRetentionRef.current);
        const savedRetention = cleanChatRetention(serverRetentionRef.current);
        const targetChatId = chatIdRef.current;
        if (!targetChatId || !retentionChangedRef.current || nextRetention === savedRetention) {
            retentionChangedRef.current = false;
            return savedRetention;
        }
        if (savingRetentionRef.current) {
            return savingRetentionRef.current;
        }

        const save = setChatTtl(targetChatId, nextRetention)
            .then((retention) => {
                const confirmedRetention = cleanChatRetention(retention);
                serverRetentionRef.current = confirmedRetention;
                pendingRetentionRef.current = confirmedRetention;
                retentionChangedRef.current = false;
                if (openRef.current) {
                    form.setValue('retention', confirmedRetention);
                }
                return confirmedRetention;
            })
            .catch((error) => {
                pendingRetentionRef.current = serverRetentionRef.current;
                retentionChangedRef.current = false;
                if (openRef.current) {
                    form.setValue('retention', serverRetentionRef.current);
                }
                console.error('chat settings update failed', error);
                toast('save failed', {
                    description: error?.message || 'Could not update this chat.',
                });
                throw error;
            })
            .finally(() => {
                savingRetentionRef.current = null;
            });
        savingRetentionRef.current = save;
        return save;
    }, [form, setChatTtl]);

    useEffect(() => {
        savePendingRetentionRef.current = savePendingRetention;
    }, [savePendingRetention]);

    useEffect(() => {
        return () => {
            openRef.current = false;
            void savePendingRetentionRef.current?.().catch(() => {});
        };
    }, []);

    const handlePayments = () => {
        openDialog('payments', { peer: user });
    };

    const handlePickAttachment = () => {
        if (!user?.chatPK) return;
        fileRef.current?.click?.();
    };

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !user?.chatPK) return;
        await savePendingRetention().catch(() => {});
        close();
        try {
            await sendAttachment(user.chatPK, await prepareChatFile(file));
            toast(`sent attachment to ${formatUserDisplay(user, false)}`, { icon: <CircleCheck /> });
        } catch (error) {
            toast.error(error?.message || 'failed to send attachment');
        }
    };

    const handleUsernameClick = () => {
        if (user?.walletPK) {
            navigator.clipboard.writeText(user.walletPK);
            toast('wallet public key copied to clipboard', {
                ...(cloaked ? {} : { description: user.walletPK }),
                icon: <Copy />,
            });
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!msgContent.trim() || !user?.chatPK || !chatPK) return;
        const messageToSend = msgContent.trim();
        setMsgContent('');
        await savePendingRetention().catch(() => {});
        close();
        try {
            const message = makeTxt(messageToSend);
            await sendMessage(user.chatPK, message);
            const truncatedMessage = messageToSend.length > 28 ? messageToSend.substring(0, 28) + '...' : messageToSend;
            toast(`sent message to ${formatUserDisplay(user, false)}`, {
                ...(cloaked ? {} : { description: truncatedMessage }),
                icon: <CircleCheck />,
            });
        } catch (error) {
            toast('Failed to send message.');
        }
    };

    const handleBlock = () => {
        if (!user?.uid || isOwnProfile || blocked) return;
        openDialog('block', {
            peer: user,
            onCancel: () => openDialog('userdetails', { user }),
            onConfirm: async () => {
                await blockPeer?.(user);
                if (selectedChatId && getPeerChatPKFromChatId(selectedChatId, chatPK) === user?.chatPK) {
                    dropChat?.(selectedChatId);
                }
                dropPeer?.(user);
                toast('user blocked', {
                    icon: <UserX />,
                    description: formatUserDisplay(user, true),
                });
            },
        });
    };

    const handleDeleteChat = () => {
        if (!chatId) return;
        discardPendingRetention();
        openDialog('alert', {
            title: 'delete chat?',
            description: `your chat with ${formatUserDisplay(user, true)} will be permanently deleted.`,
            confirmLabel: 'delete',
            confirmIcon: <Trash2 className="size-4" />,
            onCancel: () => openDialog('userdetails', { user }),
            onConfirm: () => {
                startDeleteChat?.(chatId, { keepSelected: true });
                void httpsCallable(getFunctions(), 'deleteChat')({ chatId })
                    .then(() => {
                        finishDeleteChat?.(chatId);
                    })
                    .catch((error) => {
                        restoreDeletedChat?.(chatId);
                        console.error('delete chat failed', error);
                        toast('delete failed', {
                            description: error?.message || 'Could not delete this chat.',
                        });
                    });
            },
        });
    };

    const handleRetentionChange = useCallback(
        (value) => {
            if (!value || !chatId) return;
            const nextRetention = cleanChatRetention(value);
            pendingRetentionRef.current = nextRetention;
            retentionChangedRef.current = nextRetention !== serverRetentionRef.current;
            form.setValue('retention', nextRetention);
        },
        [chatId, form]
    );

    const showInput = !isOwnProfile && user?.chatPK && !chatBanned && !blocked;
    const showChatSettings = !isOwnProfile && !!chatId;

    useEffect(() => {
        if (showInput) {
            messageInputRef.current?.focus({ preventScroll: true });
        }
    }, [showInput]);

    if (isOwnProfile) {
        return null;
    }

    return (
        <div className="flex flex-col gap-3 w-lg">
            <Card className="py-2">
                <div className="flex flex-row items-center justify-between gap-2 px-4 pt-2 pb-2">
                    <div className="pointer-events-none flex items-center gap-2 cursor-pointer" onClick={handleUsernameClick} title="Click to copy address">
                        <Avatar active={user?.active} bot={!!user?.bot} className="size-12 grower pointer-events-auto">
                            <AvatarImage src={user?.avatar} />
                            <AvatarFallback />
                        </Avatar>
                        <div className="flex-1">
                            <div className="text-xl">
                                <span className="transition-colors pointer-events-auto">{user && formatUserDisplay(user, true)}</span>
                            </div>
                        </div>
                    </div>
                    {!isOwnProfile && (
                        <div className="flex items-center gap-3 shrink-0">
                            <Button className="grower-lg pointer-events-auto" onClick={handleBlock} disabled={blocked}>
                                <UserX className="size-6" />
                            </Button>
                            <Button className="grower-lg pointer-events-auto" onClick={() => openDialog('report', { peer: user, onCancel: () => openDialog('userdetails', { user }) })}>
                                <Flag className="size-6" />
                            </Button>
                            {showChatSettings ? (
                                <Trash2
                                    className="size-6 grower-lg cursor-pointer text-destructive pointer-events-auto"
                                    role="button"
                                    tabIndex={0}
                                    aria-label="delete chat"
                                    onClick={handleDeleteChat}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            handleDeleteChat();
                                        }
                                    }}
                                />
                            ) : null}
                        </div>
                    )}
                </div>
                {showChatSettings ? (
                    <div className="flex flex-col gap-4 px-4 pt-2 pb-3">
                        <div className="bg-border h-px w-full shrink-0 rounded-full" aria-hidden />
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <div className="pl-[5px] flex items-center gap-2 text-lg font-black leading-none select-none">
                                    <Clock3 />
                                    <span>auto delete</span>
                                </div>
                                <p className="mt-1 pl-9 text-sm text-muted">choose when messages expire.</p>
                            </div>
                            <ToggleGroup type="single" value={form.watch('retention')} onValueChange={handleRetentionChange} required>
                                {RETENTION_OPTIONS.map((option) => (
                                    <ToggleGroupItem key={option.value} value={option.value}>
                                        {option.icon ? <option.icon /> : option.label}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                        </div>
                    </div>
                ) : null}
            </Card>
            {showInput && (
                <form onSubmit={handleSendMessage} className="w-full">
                    <div className="flex items-end relative">
                        <input ref={fileRef} type="file" hidden onChange={handleFileChange} />
                        <Input
                            ref={messageInputRef}
                            value={msgContent}
                            onChange={(e) => setMsgContent(e.target.value)}
                            placeholder="send a message"
                            end={
                                msgContent.trim() ? (
                                    <Button type="submit" className="grower-lg">
                                        <CircleArrowRight />
                                    </Button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Button type="button" className="grower-lg" onClick={handlePickAttachment}>
                                            <Paperclip />
                                        </Button>
                                        {user?.walletPK && (
                                            <Button type="button" className="grower-lg" onClick={handlePayments}>
                                                <HandCoins />
                                            </Button>
                                        )}
                                    </div>
                                )
                            }
                            endPos="right-2.5 bottom-2"
                            endPad="pr-20"
                            className={cloaked ? 'cloaked' : ''}
                            maxLength={256}
                        />
                    </div>
                </form>
            )}
        </div>
    );
}
