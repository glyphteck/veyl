'use client';

import { Button } from '@/components/button';
import { cn } from '@/lib/utils';
import { CircleArrowRight, HandCoins, Paperclip, Reply, SquarePen, X } from 'lucide-react';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { getCommandContext, parseCommand } from '@glyphteck/shared/commands';

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

function getDraftPreview(msg) {
    if (!msg) {
        return '';
    }
    if (msg?.t === 'req') {
        return 'payment request';
    }
    if (typeof msg?.c === 'string' && msg.c.trim()) {
        return msg.c.trim();
    }
    if (typeof msg?.n === 'string' && msg.n.trim()) {
        return msg.n.trim();
    }
    if (msg?.t === 'img') {
        return 'image';
    }
    if (msg?.t === 'file' || msg?.t === 'mp3' || msg?.t === 'mp4') {
        return 'attachment';
    }
    return 'message';
}

function DraftBar({ draft, onClear }) {
    if (!draft) {
        return null;
    }

    const DraftIcon = draft.mode === 'edit' ? SquarePen : Reply;

    return (
        <div className="pointer-events-auto mb-2 flex items-center gap-3 rounded-round bg-background/70 px-4 py-2 shadow backdrop-blur-sm">
            <DraftIcon className="size-5 shrink-0" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-foreground">{getDraftPreview(draft.msg)}</p>
            </div>
            <Button onClick={onClear} className="grower size-4.5 text-muted">
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
                    <button key={item} type="button" className="grower rounded-round" onClick={() => onSelect?.(getCommandPrefix(item))}>
                        {body}
                    </button>
                );
            })}
        </div>
    );
}

export function ChatInput({ onSendMessage, onEditMessage, onSendAttachment, onSendMoney, onCommand, onHeightChange, disabled = false, inputRef, draft, onClearDraft }) {
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
            Promise.resolve(onCommand?.(parsedCommand)).catch((error) => {
                console.error('chat command failed', error);
            });
            return;
        }
        const messageToSend = msgInput.trim();
        if (draft?.mode === 'edit') {
            setMsgInput('');
            if (textareaRef.current) textareaRef.current.style.height = 'auto';
            onClearDraft?.();
            Promise.resolve(onEditMessage?.(draft.msg, messageToSend)).catch((error) => {
                console.error('chat edit failed', error);
            });
            return;
        }
        setMsgInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        const nextDraft = draft;
        onClearDraft?.();
        onSendMessage(messageToSend, nextDraft);
    };

    const handlePickAttachment = () => {
        if (disabled) return;
        fileRef.current?.click?.();
    };

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || disabled || !onSendAttachment) return;
        await onSendAttachment(file);
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
            <DraftBar draft={draft} onClear={onClearDraft} />
            <div className="pointer-events-auto flex items-end gap-2 bg-background/70 px-2.5 pt-0.5 shadow backdrop-blur-sm rounded-round">
                <input ref={fileRef} type="file" hidden onChange={handleFileChange} disabled={disabled} />
                <ChatTextarea
                    ref={textareaRef}
                    className={`min-h-9 flex-1 bg-transparent pl-1.5 pr-1 py-1 shadow-none resize-none ${cloaked ? 'cloaked' : ''}`}
                    value={msgInput}
                    onChange={(e) => setMsgInput(e.target.value)}
                    onKeyPress={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMsg();
                        }
                    }}
                    maxRows={12}
                    maxLength={5000}
                    placeholder="send a message"
                    disabled={disabled}
                />
                <div className="flex  items-center self-center">
                    {canSend ? (
                        <Button onClick={handleSendMsg} className="grower size-5" disabled={!canSend}>
                            <CircleArrowRight className="size-5.5" />
                        </Button>
                    ) : (
                        <div className="flex items-center gap-3 pr-1.5">
                            <Button onClick={handlePickAttachment} className="grower size-5" disabled={disabled}>
                                <Paperclip className="size-5" />
                            </Button>
                            <Button onClick={onSendMoney} className="grower size-5" disabled={disabled || !onSendMoney}>
                                <HandCoins className="size-5" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
