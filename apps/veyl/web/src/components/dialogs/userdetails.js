'use client';

import { Card } from '@/components/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { useUser } from '@/components/providers/userprovider';
import { useChat } from '@/components/providers/chatprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { makeTxt } from '@glyphteck/shared/chat/messages';
import { usePeer } from '@/components/providers/peerprovider';
import { formatUserDisplay } from '@/lib/utils';
import { prepareChatFile } from '@/lib/chatfiles';
import { HandCoins, Copy, CircleArrowRight, CircleCheck, Flag, Paperclip, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { useEffect, useMemo, useState, useRef } from 'react';
import { getPeerChatPKFromChatId } from '@glyphteck/shared/chat/utils';

export default function UserDetails({ data, close }) {
    const { uid, chatPK, chatBanned, blockPeer, isBlocked } = useUser();
    const { sendMessage, sendAttachment, selectedChatId, dropChat } = useChat();
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

    useEffect(() => {
        if (user?.uid && user.uid !== uid) {
            updatePeer(user.uid, { refreshAvatar: true });
        }
    }, [user?.uid, uid, updatePeer]);

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
        close();
        try {
            await sendAttachment(user.chatPK, await prepareChatFile(file));
            toast(`sent attachment to ${formatUserDisplay(user, false)}`, { icon: <CircleCheck /> });
        } catch (error) {
            console.error('Failed to send attachment:', error);
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
            console.error('Failed to send message:', error);
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

    const showInput = !isOwnProfile && user?.chatPK && !chatBanned && !blocked;

    useEffect(() => {
        if (showInput) {
            messageInputRef.current?.focus({ preventScroll: true });
        }
    }, [showInput]);

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
                        </div>
                    )}
                </div>
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
