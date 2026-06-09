'use client';

import { Button } from '@/components/button';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useUser } from '@/components/providers/userprovider';
import { cn } from '@/lib/classes';
import { AudioLines, CircleArrowRight, File, Film, HandCoins, Image as ImageIcon, Paperclip, Reply, SquarePen, X } from 'lucide-react';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { getCommandContext, parseCommand } from '@veyl/shared/commands';
import { getRequestContext } from '@veyl/shared/chat/messages';

const ChatTextarea = forwardRef(function ChatTextarea({ className, maxRows = Infinity, onInput, ...props }, ref) {
    const handleInput = (event) => {
        const textarea = event.currentTarget;
        textarea.style.height = 'auto';

        if (maxRows !== Infinity) {
            const style = getComputedStyle(textarea);
            const lineHeight = parseFloat(style.lineHeight);
            const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
            const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
            const maxHeight = lineHeight * maxRows + paddingY;
            const nextHeight = Math.min(textarea.scrollHeight + borderY, maxHeight + borderY);
            textarea.style.height = `${nextHeight}px`;
            textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
            if (textarea.scrollHeight > maxHeight) {
                textarea.scrollTop = textarea.scrollHeight - nextHeight;
            }
        } else {
            textarea.style.height = `${textarea.scrollHeight}px`;
        }

        onInput?.(event);
    };

    return (
        <textarea
            ref={ref}
            className={cn('w-full rounded-round px-3 py-1.5 outline-none placeholder:text-muted field-sizing-content disabled:opacity-50', className)}
            onInput={handleInput}
            {...props}
        />
    );
});

function getAttachmentDraftTitle(msg) {
    if (typeof msg?.n === 'string' && msg.n.trim()) {
        return msg.n.trim();
    }

    switch (msg?.t) {
        case 'img':
            return 'image';
        case 'mp3':
            return 'audio';
        case 'mp4':
            return 'video';
        case 'file':
            return 'file';
        default:
            return '';
    }
}

function getDraftPreview(msg, context) {
    if (!msg) {
        return '';
    }
    if (msg?.t === 'req') {
        return getRequestContext(msg, context).text;
    }
    const attachmentTitle = getAttachmentDraftTitle(msg);
    if (attachmentTitle) {
        return attachmentTitle;
    }
    if (typeof msg?.c === 'string' && msg.c.trim()) {
        return msg.c.trim();
    }
    return 'message';
}

function getDraftTypeIcon(msg) {
    switch (msg?.t) {
        case 'img':
            return ImageIcon;
        case 'mp3':
            return AudioLines;
        case 'mp4':
            return Film;
        case 'file':
            return File;
        case 'req':
            return HandCoins;
        default:
            return null;
    }
}

function DraftBar({ draft, peerDisplayName, onClear }) {
    const { settings } = useUser();
    const bitcoin = useBitcoin();
    const { getTxById } = useTxData();

    if (!draft) {
        return null;
    }

    const DraftIcon = draft.mode === 'edit' ? SquarePen : Reply;
    const DraftTypeIcon = getDraftTypeIcon(draft.msg);

    return (
        <div className="pointer-events-auto mb-2 flex items-center gap-3 rounded-round bg-background/70 px-4 py-2 shadow backdrop-blur-sm">
            <DraftIcon className="size-5 shrink-0" />
            {DraftTypeIcon ? <DraftTypeIcon className="size-4.5 shrink-0 text-muted" /> : null}
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-foreground">{getDraftPreview(draft.msg, { fromPeer: draft.fromPeer, peerDisplayName, moneyFormat: settings?.moneyFormat, btcPrice: bitcoin?.price, getTxById })}</p>
            </div>
            <Button onClick={onClear} className="grower size-4.5 text-muted" tabbable={false}>
                <X className="size-4.5" />
            </Button>
        </div>
    );
}

function getCommandPrefix(item) {
    const token = String(item ?? '')
        .trim()
        .split(/\s+/)[0];
    return token ? `${token} ` : '';
}

function splitCommandHint(item) {
    const text = String(item ?? '').trim();
    if (!text) {
        return { prefix: '', rest: '' };
    }
    const [prefix, ...rest] = text.split(/\s+/);
    return { prefix, rest: rest.join(' ') };
}

function CommandBubbles({ items, onSelect, interactive = true }) {
    if (!items?.length) {
        return null;
    }

    return (
        <div className="pointer-events-auto mb-2 flex flex-wrap items-start gap-3">
            {items.map((item) => {
                const { prefix, rest } = splitCommandHint(item);
                const body = (
                    <div className="flex items-center gap-2 rounded-round bg-background/70 px-3 py-1.5 text-sm font-black shadow backdrop-blur-sm">
                        <span className={interactive ? 'font-mono' : 'font-mono text-foreground'}>{prefix}</span>
                        {rest ? <span className="font-mono text-muted">{rest}</span> : null}
                    </div>
                );

                if (!interactive) {
                    return <div key={item}>{body}</div>;
                }

                return (
                    <Button key={item} type="button" className="h-auto rounded-round p-0 grower" onClick={() => onSelect?.(getCommandPrefix(item))} tabbable={false}>
                        {body}
                    </Button>
                );
            })}
        </div>
    );
}

export function ChatInput({
    onSendMessage,
    onEditMessage,
    onSendAttachments,
    onSendMoney,
    onCommand,
    onHeightChange,
    disabled = false,
    inputRef,
    attachmentButtonRef,
    moneyButtonRef,
    draft,
    peerDisplayName,
    onClearDraft,
    onEscape,
}) {
    const { cloaked } = useCloak();
    const [msgInput, setMsgInput] = useState('');
    const textareaRef = inputRef;
    const fileRef = useRef(null);
    const containerRef = useRef(null);
    const canSend = !!msgInput.trim() && !disabled;
    const showCommands = !disabled && draft?.mode !== 'edit' && msgInput.startsWith('/');
    const parsedCommand = showCommands ? parseCommand(msgInput, { mode: 'chat' }) : null;
    const commandContext = showCommands ? getCommandContext(msgInput, { mode: 'chat' }) : { kind: 'none', items: [] };

    const applyCommandPrefix = (prefix) => {
        if (!prefix || disabled) {
            return;
        }
        setMsgInput(prefix);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.focus?.();
            requestAnimationFrame(() => {
                const input = textareaRef.current;
                if (!input) {
                    return;
                }
                input.style.height = `${input.scrollHeight}px`;
                input.setSelectionRange?.(prefix.length, prefix.length);
            });
        }
    };

    const handleSendMsg = async () => {
        if (!msgInput.trim()) return;
        if (parsedCommand) {
            if (!parsedCommand.complete) {
                return;
            }
            setMsgInput('');
            if (textareaRef.current) textareaRef.current.style.height = 'auto';
            onClearDraft?.();
            Promise.resolve(onCommand?.(parsedCommand)).catch(() => {});
            return;
        }
        const messageToSend = msgInput.trim();
        if (draft?.mode === 'edit') {
            setMsgInput('');
            if (textareaRef.current) textareaRef.current.style.height = 'auto';
            onClearDraft?.();
            Promise.resolve(onEditMessage?.(draft.msg, messageToSend)).catch(() => {});
            return;
        }
        setMsgInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        const nextDraft = draft;
        onClearDraft?.();
        onSendMessage(messageToSend, nextDraft);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onEscape?.();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMsg();
        }
    };

    const handlePickAttachment = () => {
        if (disabled) return;
        fileRef.current?.click?.();
    };

    const handleFileChange = async (e) => {
        const files = Array.from(e.target.files || []).filter(Boolean);
        e.target.value = '';
        if (!files.length || disabled || !onSendAttachments) return;
        await onSendAttachments(files);
    };

    useEffect(() => {
        if (draft?.mode !== 'edit') {
            return;
        }
        const text = typeof draft?.msg?.c === 'string' ? draft.msg.c : '';
        setMsgInput(text);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
            textareaRef.current.focus?.();
        }
    }, [draft, textareaRef]);

    useEffect(() => {
        const node = containerRef.current;
        if (!node || typeof onHeightChange !== 'function') {
            return;
        }

        const emit = () => onHeightChange(node.offsetHeight || 0);
        emit();

        if (typeof ResizeObserver === 'undefined') {
            return undefined;
        }

        const observer = new ResizeObserver(() => emit());
        observer.observe(node);
        return () => observer.disconnect();
    }, [commandContext.kind, commandContext.items.length, draft?.mode, onHeightChange]);

    return (
        <div ref={containerRef} className="pointer-events-none z-35 absolute inset-x-0 bottom-0 mx-auto mb-6 w-[calc(100%-6rem)] max-w-3xl">
            <CommandBubbles items={commandContext.items} onSelect={applyCommandPrefix} interactive={commandContext.kind === 'pick'} />
            <DraftBar draft={draft} peerDisplayName={peerDisplayName} onClear={onClearDraft} />
            <div className="pointer-events-auto flex items-end gap-2 bg-background/70 px-2.5 pt-0.5 shadow backdrop-blur-sm rounded-round">
                <input ref={fileRef} type="file" hidden multiple onChange={handleFileChange} disabled={disabled} />
                <ChatTextarea
                    ref={textareaRef}
                    className={`min-h-9 flex-1 bg-transparent pl-1.5 pr-1 py-1 shadow-none resize-none ${cloaked ? 'cloaked' : ''}`}
                    value={msgInput}
                    onChange={(e) => setMsgInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxRows={12}
                    maxLength={5000}
                    placeholder="send a message"
                    disabled={disabled}
                />
                <div className="flex  items-center self-center">
                    {canSend ? (
                        <Button onClick={handleSendMsg} className="grower size-5" disabled={!canSend} tabbable={false}>
                            <CircleArrowRight className="size-5.5" />
                        </Button>
                    ) : (
                        <div className="flex items-center gap-3 pr-1.5">
                            <Button ref={attachmentButtonRef} onClick={handlePickAttachment} className="grower size-5" disabled={disabled} tabbable={false}>
                                <Paperclip className="size-5" />
                            </Button>
                            <Button ref={moneyButtonRef} onClick={onSendMoney} className="grower size-5" disabled={disabled || !onSendMoney} tabbable={false}>
                                <HandCoins className="size-5" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
