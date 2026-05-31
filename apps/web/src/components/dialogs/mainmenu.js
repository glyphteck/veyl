import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import {
    MessageCircle,
    MessageCirclePlus,
    Wallet,
    Camera,
    History,
    ArrowUpRight,
    ArrowDownLeft,
    BanknoteArrowDown,
    BanknoteArrowUp,
    Settings2,
    Trash2,
    Lock,
    LogOut,
    Eye,
    EyeOff,
    Loader,
    Box,
    Bot,
    Hammer,
    Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '@/components/providers/dialogprovider';
import { useUser } from '@/components/providers/userprovider';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { formatCacheSize } from '@veyl/shared/utils/display';
import { mergeProfiles } from '@veyl/shared/search/merge';
import { sameText } from '@veyl/shared/utils/text';
import { completeCommandPrefix, getTypingUsername, matchCommands, parseCommand, parseCommandAmountSats } from '@veyl/shared/commands';
import { hasAvailableBalance } from '@veyl/shared/wallet/balance';
import { useChat } from '@/components/providers/chatprovider';
import { cn } from '@/lib/classes';
import { formatUserDisplay } from '@veyl/shared/profile';
import { renderMoney } from '@veyl/shared/money';
import { formatFullDateTime } from '@veyl/shared/utils/time';
import {
    LIST_HEIGHT,
    ROW_HEIGHT,
    countRows,
    findRow,
    getOrderedPeers,
    getVisibleWindow,
    textMatches,
} from '@/lib/mainmenu';
import { useSearch } from '@/lib/search/usesearch';
import { shortcuts } from '@/lib/shortcuts';
import { isEditableTarget, listNavigationStep } from '@/lib/focus';
import { Bitcoin } from '@/components/bitcoin';
import { getMsgPreview as displayLastMsg, makeReq, makeTxt } from '@veyl/shared/chat/messages';
import { Dot } from '@/components/dot';
import { qr } from '@veyl/shared/qr';
import { getChatId } from '@veyl/shared/crypto/chat';

function rowsSection(key, rows) {
    return {
        key,
        count: rows.length,
        keyFor: (index) => rows[index]?.key,
        select: (index) => rows[index]?.select?.(),
        render: (index, active, onActive, separated) => {
            const row = rows[index];
            if (!row) return null;
            return (
                <MainMenuItem active={active} className={cn(separated && 'shadow-[inset_0_1px_0_0_var(--border)]', row.className)} onActive={onActive} onSelect={row.select}>
                    {row.content}
                </MainMenuItem>
            );
        },
    };
}

function MainMenuInput({ inputRef, listId, activeId, value, onChange, onKeyDown }) {
    return (
        <div className="flex items-center gap-2 px-3 shadow-sm">
            <Search className="text-muted" />
            <input
                ref={inputRef}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeId || undefined}
                className="w-full bg-transparent py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="search for anything"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={onKeyDown}
            />
        </div>
    );
}

function MainMenuItem({ active, className, children, onActive, onSelect }) {
    return (
        <button
            type="button"
            tabIndex={-1}
            data-active={active ? 'true' : undefined}
            className={cn(
                'relative flex h-9 w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-base select-none outline-none data-[active=true]:bg-foreground/5 [&>*:nth-child(-n+2)]:transition-transform [&>*:nth-child(-n+2)]:ease-out hover:[&>*:nth-child(-n+2)]:translate-x-3 data-[active=true]:[&>*:nth-child(-n+2)]:translate-x-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&>*.avatar]:size-6',
                className
            )}
            onMouseEnter={onActive}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onSelect}
        >
            {children}
        </button>
    );
}

function MainMenuShortcut({ className, ...props }) {
    return <span className={cn('ml-auto text-sm font-black tracking-widest text-muted', className)} {...props} />;
}

function MainMenuEmpty({ children }) {
    return <div className="flex h-18 items-center justify-center py-1.5 text-muted">{children}</div>;
}

function MainMenuList({ id, resetKey, sections, activeIndex, setActiveIndex, empty }) {
    const ref = useRef(null);
    const [scrollTop, setScrollTop] = useState(0);
    const total = countRows(sections);
    const { start, end } = getVisibleWindow({ scrollTop, total });
    const visible = [];

    for (let index = start; index < end; index += 1) {
        const row = findRow(sections, index);
        if (!row) continue;
        visible.push(
            <div
                key={`${row.section.key}:${row.key}`}
                id={`${id}-item-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className="absolute inset-x-0"
                style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
                {row.section.render(row.localIndex, index === activeIndex, () => setActiveIndex(index), index > 0 && row.localIndex === 0)}
            </div>
        );
    }

    useEffect(() => {
        const node = ref.current;
        if (!node || activeIndex < 0) return;
        const top = activeIndex * ROW_HEIGHT;
        const bottom = top + ROW_HEIGHT;
        if (top < node.scrollTop) {
            node.scrollTop = top;
        } else if (bottom > node.scrollTop + node.clientHeight) {
            node.scrollTop = bottom - node.clientHeight;
        }
    }, [activeIndex, total]);

    useEffect(() => {
        const node = ref.current;
        if (node) node.scrollTop = 0;
        setScrollTop(0);
    }, [resetKey]);

    if (!total) {
        return <MainMenuEmpty>{empty}</MainMenuEmpty>;
    }

    return (
        <div
            ref={ref}
            id={id}
            role="listbox"
            className="min-h-0 overflow-y-auto"
            style={{ maxHeight: LIST_HEIGHT }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="relative" style={{ height: total * ROW_HEIGHT }}>
                {visible}
            </div>
        </div>
    );
}

export default function MainMenu({ close, data, open = true }) {
    const router = useRouter();
    const { openDialog } = useDialog();
    const { uid, username, settings, chatPK, chatBanned, isAdmin, avatar, walletPK } = useUser();
    const bitcoin = useBitcoin();
    const { copyFundingAddress, fundingAddress, getFundingAddress, sendMoneyWithSpark, balance, hasMoreTxs, isTxLoading, loadMoreTxs } = useWallet();
    const { lock, localCache } = useVault();
    const { hasTx, sortedTransactions } = useTxData();
    const { hasChats, lastChat, chats, sendMessage, selectChat } = useChat();
    const { peers, recentPeers, peerByWalletPK, peerByChatPK, addPeer } = usePeer();
    const { cloaked, cloak } = useCloak();
    const { searching, results, query, search, clearSearch } = useSearch('mainmenu');
    const [searchValue, setSearchValue] = useState(data?.searchInput || '');
    const [activeIndex, setActiveIndex] = useState(0);
    const [cacheSize, setCacheSize] = useState(0);
    const inputRef = useRef(null);
    const clearingCacheRef = useRef(false);
    const cacheRefreshRef = useRef(0);
    const hasBalance = balance && balance > 0;
    const hasUnseenChats = !!chats?.some((c) => c?.unseen);
    const showWalletDot = false;
    const showAllTx = searchValue.trim() === '#';
    const browseUsers = query?.kind === 'username' && !query.value;
    const showSlashCommands = searchValue.startsWith('/');
    const showUserSearch = !!query && !showSlashCommands;

    const openUser = useCallback(
        (peer) => {
            openDialog(peer?.uid && peer.uid === uid ? 'settings' : 'userdetails', peer?.uid && peer.uid === uid ? null : { user: peer });
        },
        [openDialog, uid]
    );
    const matchedSlashCommands = showSlashCommands ? matchCommands(searchValue, { mode: 'mainmenu' }) : [];
    const parsedSlashCommand = showSlashCommands ? parseCommand(searchValue, { mode: 'mainmenu' }) : null;
    const typingUsername = showSlashCommands ? getTypingUsername(searchValue, { mode: 'mainmenu' }) : null;

    const openFundingQr = async () => {
        close();
        const address = fundingAddress || (await getFundingAddress());
        if (!address) return;
        openDialog('qrcode', { type: qr.bitcoin, value: address });
        void copyFundingAddress(address).catch(() => {});
    };

    const runSlashCommand = async (parsed) => {
        if (!parsed?.complete) return;
        let peer =
            [...(peers || []), ...(results || [])].find((p) => {
                if (!p?.username || !parsed.args.username) return false;
                return sameText(p.username, parsed.args.username);
            }) ?? null;
        if (!peer && parsed.args.username) {
            peer = await addPeer?.({ username: parsed.args.username });
        }
        if (!peer) {
            toast.error('user not found');
            return;
        }
        if (parsed.name === 'send') {
            const amountSats = parseCommandAmountSats(parsed.args.amount);
            if (!amountSats) {
                toast.error('invalid amount');
                return;
            }
            if (!peer?.walletPK) {
                toast.error('this person cannot receive money yet');
                return;
            }
            if (peer.walletPK === walletPK) {
                toast.error('cannot send money to yourself');
                return;
            }
            const displayName = formatUserDisplay(peer, false);
            const formattedAmount = renderMoney(amountSats, settings?.moneyFormat || 'sats', bitcoin?.price);
            close();
            const loadingToastId = toast(`sending ${formattedAmount} to ${displayName}`, {
                icon: <Loader className="size-4 animate-spin" />,
                duration: Infinity,
            });
            try {
                await sendMoneyWithSpark(peer.walletPK, amountSats);
                toast.success(`sent ${formattedAmount} to ${displayName}`, { id: loadingToastId, duration: 2000 });
            } catch (error) {
                toast.error(error?.message || 'failed to send money', { id: loadingToastId, duration: 2000 });
            }
        } else if (parsed.name === 'request') {
            const amountSats = parseCommandAmountSats(parsed.args.amount);
            if (!amountSats) {
                toast.error('invalid amount');
                return;
            }
            if (chatBanned) {
                toast.error('chat unavailable');
                return;
            }
            if (!peer?.chatPK) {
                toast.error('this person cannot receive requests yet');
                return;
            }
            if (peer.uid === uid) {
                toast.error('cannot request money from yourself');
                return;
            }
            const displayName = formatUserDisplay(peer, false);
            close();
            try {
                await sendMessage(peer.chatPK, makeReq(amountSats));
                toast(`requested ${renderMoney(amountSats, settings?.moneyFormat || 'sats', bitcoin?.price)} from ${displayName}`);
            } catch (error) {
                console.error('mainmenu request failed', error);
                toast.error(error?.message || 'failed to send request');
            }
        } else if (parsed.name === 'msg') {
            if (chatBanned) {
                toast.error('chat unavailable');
                return;
            }
            if (!peer?.chatPK || !parsed.args.message) {
                toast.error('this person cannot receive messages yet');
                return;
            }
            const chatId = getChatId(chatPK, peer.chatPK);
            close();
            selectChat(chatId);
            router.push('/chat');
            void sendMessage(peer.chatPK, makeTxt(parsed.args.message)).catch((error) => {
                console.error('mainmenu msg failed', error);
            });
        }
    };

    const handleSearchChange = (value) => {
        setSearchValue(value);
        if (!value) {
            clearSearch();
            return;
        }
        if (value.startsWith('/')) {
            const typing = getTypingUsername(value, { mode: 'mainmenu' });
            if (typing !== null) search(`@${typing}`);
            else clearSearch();
        } else {
            search(value);
        }
    };

    const handleInputCompletion = (event) => {
        if (event.key !== 'Tab' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        const next = completeCommandPrefix(searchValue, { mode: 'mainmenu' });
        if (!next) {
            return;
        }
        event.preventDefault();
        handleSearchChange(next);
        requestAnimationFrame(() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus({ preventScroll: true });
            input.setSelectionRange?.(next.length, next.length);
        });
    };

    useEffect(() => {
        if (searchValue) handleSearchChange(searchValue);
    }, []);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus({ preventScroll: true });
            if (data?.searchInput) {
                input.setSelectionRange(input.value.length, input.value.length);
            }
        }, 0);

        return () => window.clearTimeout(timeout);
    }, [data?.searchInput]);

    const refreshCacheSize = useCallback(() => {
        const requestId = cacheRefreshRef.current + 1;
        cacheRefreshRef.current = requestId;
        if (!localCache?.estimateSize) {
            setCacheSize(0);
            return;
        }

        localCache
            .estimateSize()
            .then((size) => {
                if (cacheRefreshRef.current === requestId) {
                    setCacheSize(Number(size) || 0);
                }
            })
            .catch(() => {
                if (cacheRefreshRef.current === requestId) {
                    setCacheSize(0);
                }
            });
    }, [localCache]);

    useEffect(() => {
        if (!open) return;
        refreshCacheSize();
    }, [open, refreshCacheSize]);

    useEffect(() => {
        return () => {
            cacheRefreshRef.current += 1;
        };
    }, [localCache]);

    const topPeers = (recentPeers?.all || []).slice(0, 3);
    const matchedPeers = useMemo(() => {
        if (!query) return [];
        if (browseUsers) {
            return getOrderedPeers({ peers, recentPeers, excludeUid: uid });
        }
        return mergeProfiles({ local: peers || [], remote: results || [], parsed: query, excludeUid: uid });
    }, [browseUsers, peers, query, recentPeers?.all, results, uid]);
    const txs = useMemo(() => (showAllTx ? sortedTransactions || [] : []), [showAllTx, sortedTransactions]);

    const openRoute = (href) => {
        router.push(href);
        close();
    };
    const appVersion = process.env.APP_VERSION || '';

    const clearCache = async () => {
        if (!localCache || clearingCacheRef.current) return;
        clearingCacheRef.current = true;
        try {
            await localCache.clear();
            setCacheSize(0);
        } catch (error) {
            console.error('main menu cache clear failed', error);
        } finally {
            clearingCacheRef.current = false;
        }
    };

    const focusInput = () => {
        window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    };

    const userSection = (key, list, select) => ({
        key,
        count: list.length,
        keyFor: (index) => list[index]?.uid || `${key}-${index}`,
        select: (index) => select(list[index]),
        render: (index, active, onActive, separated) => {
            const peer = list[index];
            if (!peer) return null;
            return (
                <MainMenuItem active={active} className={separated && 'shadow-[inset_0_1px_0_0_var(--border)]'} onActive={onActive} onSelect={() => select(peer)}>
                    <Avatar active={peer?.active} bot={!!peer?.bot}>
                        <AvatarImage src={peer.avatar} alt={peer.username || 'user'} />
                        <AvatarFallback />
                    </Avatar>
                    <span>{formatUserDisplay(peer, true)}</span>
                </MainMenuItem>
            );
        },
    });

    const menuSections = [];

    if (showSlashCommands && matchedSlashCommands.length > 0) {
        if (parsedSlashCommand?.complete) {
            const { username: targetUsername, amount, message } = parsedSlashCommand.args;
            const label = parsedSlashCommand.name === 'msg' ? `msg @${targetUsername}: ${message}` : `${parsedSlashCommand.name} ${amount} sats to @${targetUsername}`;
            menuSections.push(
                rowsSection('slash', [
                    {
                        key: 'slash-execute',
                        label: `/${label}`,
                        value: searchValue,
                        keywords: [searchValue.trim()],
                        select: () => runSlashCommand(parsedSlashCommand),
                        content: <span>/{label}</span>,
                    },
                ])
            );
        } else if (typingUsername !== null && matchedPeers.length > 0) {
            menuSections.push(
                userSection('slash-users', matchedPeers, (peer) => {
                    const slashCommand = matchedSlashCommands[0];
                    if (!slashCommand || !peer?.username) return;
                    handleSearchChange(`/${slashCommand.name} @${peer.username} `);
                    focusInput();
                })
            );
        } else if (parsedSlashCommand?.args?.username) {
            const { username: targetUsername } = parsedSlashCommand.args;
            const hintLabel =
                parsedSlashCommand.name === 'msg'
                    ? `send a message to @${targetUsername}`
                    : parsedSlashCommand.name === 'send'
                      ? `send money to @${targetUsername}`
                      : parsedSlashCommand.name === 'request'
                        ? `request money from @${targetUsername}`
                        : null;
            if (hintLabel) {
                menuSections.push(
                    rowsSection('slash', [
                        {
                            key: 'slash-hint',
                            label: hintLabel,
                            value: searchValue,
                            keywords: [searchValue.trim(), `/${parsedSlashCommand.name} ${targetUsername}`, `/${parsedSlashCommand.name} ${targetUsername} `],
                            select: () => runSlashCommand(parsedSlashCommand),
                            content: <span>{hintLabel}</span>,
                        },
                    ])
                );
            }
        } else {
            menuSections.push(
                rowsSection(
                    'slash',
                    matchedSlashCommands.map((slashCommand) => ({
                        key: slashCommand.name,
                        label: slashCommand.name,
                        value: `/${slashCommand.name}`,
                        keywords: ['/', slashCommand.name, searchValue],
                        select: () => {
                            handleSearchChange(`/${slashCommand.name} @`);
                            focusInput();
                        },
                        content: <span className="font-mono">{slashCommand.syntax}</span>,
                    }))
                )
            );
        }
    }

    if (!searchValue && topPeers.length > 0) {
        menuSections.push(userSection('top-users', topPeers, openUser));
    }

    if (!showSlashCommands && !showUserSearch && !showAllTx) {
        const staticFilter = searchValue;
        const moneyRows = [
            !chatBanned && {
                key: 'newchat',
                label: 'new chat',
                keywords: ['message', 'chat', 'dm', 'conversation'],
                select: () => openDialog('newchat'),
                content: (
                    <>
                        <MessageCirclePlus />
                        <span>new chat</span>
                        <MainMenuShortcut>{shortcuts.newchat}</MainMenuShortcut>
                    </>
                ),
            },
            hasBalance && {
                key: 'sendmoney',
                label: 'send money',
                select: () => openDialog('payments', { tab: 'send' }),
                content: (
                    <>
                        <ArrowUpRight />
                        <span>send money</span>
                        <MainMenuShortcut>{shortcuts.sendmoney}</MainMenuShortcut>
                    </>
                ),
            },
            {
                key: 'requestmoney',
                label: 'request money',
                select: () => openDialog('payments', { tab: 'request' }),
                content: (
                    <>
                        <ArrowDownLeft />
                        <span>request money</span>
                        <MainMenuShortcut>{shortcuts.requestmoney}</MainMenuShortcut>
                    </>
                ),
            },
        ].filter(Boolean);
        const filteredMoneyRows = moneyRows.filter((row) => textMatches(row, staticFilter));
        if (filteredMoneyRows.length) menuSections.push(rowsSection('money', filteredMoneyRows));

        const viewRows = [
            !chatBanned && {
                key: 'chat',
                label: 'chat',
                select: () => openRoute('/chat'),
                content: (
                    <>
                        <Dot show={hasUnseenChats && !cloaked} compact>
                            <MessageCircle />
                        </Dot>
                        <span className="flex min-w-0 items-center gap-2">
                            <span>chat</span>
                            {lastChat && !cloaked && (
                                <span className="truncate text-muted">
                                    {(() => {
                                        const profile = peerByChatPK.get(lastChat.peerChatPK) ?? null;
                                        const displayName = formatUserDisplay(
                                            {
                                                username: profile?.username,
                                                chatPK: lastChat.peerChatPK,
                                            },
                                            true
                                        );
                                        const lastMessage = displayLastMsg(lastChat.lastMsg, chatPK, settings, bitcoin.price);
                                        const truncatedMessage = lastMessage.length > 24 ? `${lastMessage.slice(0, 24)}...` : lastMessage;
                                        return `${displayName}: ${truncatedMessage}`;
                                    })()}
                                </span>
                            )}
                        </span>
                        <MainMenuShortcut>{shortcuts.chat}</MainMenuShortcut>
                    </>
                ),
            },
            {
                key: 'camera',
                label: 'camera',
                keywords: ['scan', 'qr'],
                select: () => openRoute('/camera'),
                content: (
                    <>
                        <Camera />
                        <span>camera</span>
                        <MainMenuShortcut>{shortcuts.camera}</MainMenuShortcut>
                    </>
                ),
            },
            {
                key: 'wallet',
                label: 'dashboard',
                keywords: ['dashboard', 'overview', 'home', 'wallet'],
                select: () => openRoute('/wallet'),
                content: (
                    <>
                        <Dot show={showWalletDot && !cloaked} compact>
                            <Wallet />
                        </Dot>
                        <span className="flex min-w-0 items-center gap-2">
                            <span>dashboard</span>
                            {balance !== null && balance > 0 && !cloaked && <span className="truncate text-muted">{renderMoney(balance, settings?.moneyFormat, bitcoin.price)}</span>}
                        </span>
                        <MainMenuShortcut>{shortcuts.wallet}</MainMenuShortcut>
                    </>
                ),
            },
            hasTx && {
                key: 'transactions',
                label: 'transaction history',
                keywords: ['transactions', 'history'],
                select: () => openRoute('/transactions'),
                content: (
                    <>
                        <History />
                        <span>transaction history</span>
                        <MainMenuShortcut>{shortcuts.transactions}</MainMenuShortcut>
                    </>
                ),
            },
            isAdmin && {
                key: 'admin',
                label: 'admin',
                keywords: ['admin', 'reports', 'moderation'],
                select: () => openRoute('/admin/reports'),
                content: (
                    <>
                        <Hammer />
                        <span>admin</span>
                        <MainMenuShortcut>{shortcuts.admin}</MainMenuShortcut>
                    </>
                ),
            },
            isAdmin && {
                key: 'bot',
                label: 'bot',
                keywords: ['bot', 'automation', 'reviewer', 'mirror'],
                select: () => openRoute('/admin/bots'),
                content: (
                    <>
                        <Bot />
                        <span>bot</span>
                        <MainMenuShortcut>{shortcuts.bot}</MainMenuShortcut>
                    </>
                ),
            },
        ].filter(Boolean);
        const filteredViewRows = viewRows.filter((row) => textMatches(row, staticFilter));
        if (filteredViewRows.length) menuSections.push(rowsSection('views', filteredViewRows));

        const walletRows = [
            {
                key: 'fund',
                label: 'fund wallet',
                select: openFundingQr,
                content: (
                    <>
                        <BanknoteArrowDown />
                        <span>fund wallet</span>
                    </>
                ),
            },
            hasAvailableBalance(balance) && {
                    key: 'withdraw',
                    label: 'withdraw funds',
                    select: () => openDialog('withdraw'),
                    content: (
                        <>
                            <BanknoteArrowUp />
                            <span>withdraw funds</span>
                        </>
                    ),
                },
        ].filter(Boolean);
        const filteredWalletRows = walletRows.filter((row) => textMatches(row, staticFilter));
        if (filteredWalletRows.length) menuSections.push(rowsSection('wallet', filteredWalletRows));

        const appRows = [
            {
                key: 'settings',
                label: 'settings',
                keywords: ['change', 'currency', 'lock', 'profile', 'preferences', 'avatar'],
                select: () => openDialog('settings'),
                content: (
                    <>
                        <Settings2 />
                        <span>settings</span>
                        <MainMenuShortcut>{shortcuts.settings}</MainMenuShortcut>
                    </>
                ),
            },
            (hasChats || hasTx) && {
                key: 'cloak',
                label: cloaked ? 'uncloak' : 'cloak',
                keywords: ['cloak', 'uncloak', 'hide', 'vision', 'privacy', 'view', 'show'],
                select: () => {
                    close();
                    cloak();
                },
                content: (
                    <>
                        {cloaked ? <EyeOff /> : <Eye />}
                        <span>{cloaked ? 'uncloak' : 'cloak'}</span>
                        <MainMenuShortcut>{shortcuts.cloak}</MainMenuShortcut>
                    </>
                ),
            },
            {
                key: 'clear-cache',
                label: 'clear cache',
                keywords: ['cache', 'clear', 'delete', 'storage'],
                select: clearCache,
                content: (
                    <>
                        <Trash2 />
                        <span>clear cache</span>
                        <span className="ml-auto text-sm text-muted">{formatCacheSize(cacheSize)}</span>
                    </>
                ),
            },
        ].filter(Boolean);
        const filteredAppRows = appRows.filter((row) => textMatches(row, staticFilter));
        if (filteredAppRows.length) menuSections.push(rowsSection('app', filteredAppRows));

        const sessionRows = [
            {
                key: 'lock',
                label: 'lock vault',
                select: () => lock(),
                content: (
                    <>
                        <Lock />
                        <span>lock vault</span>
                        <MainMenuShortcut>{shortcuts.lock}</MainMenuShortcut>
                    </>
                ),
            },
            {
                key: 'logout',
                label: 'logout',
                select: () => openDialog('rememberaccount', { user: { uid, username, avatar } }),
                content: (
                    <>
                        <LogOut />
                        <span>logout</span>
                        <MainMenuShortcut>{shortcuts.logout}</MainMenuShortcut>
                    </>
                ),
            },
        ];
        const filteredSessionRows = sessionRows.filter((row) => textMatches(row, staticFilter));
        if (filteredSessionRows.length) menuSections.push(rowsSection('session', filteredSessionRows));

        const accountRows = [
            {
                key: 'delete-account',
                label: 'delete account',
                className: 'text-destructive',
                select: () => openDialog('deleteaccount'),
                content: (
                    <>
                        <Trash2 />
                        <span>delete account</span>
                    </>
                ),
            },
        ];
        const filteredAccountRows = accountRows.filter((row) => textMatches(row, staticFilter));
        if (filteredAccountRows.length) menuSections.push(rowsSection('account', filteredAccountRows));

        if (searchValue && bitcoin) {
            const bitcoinRow = {
                key: 'bitcoin',
                label: 'bitcoin',
                keywords: ['btc', 'price', 'mempool', 'block'],
                select: () => {
                    close();
                    window.open('https://mempool.space/', '_blank');
                },
                content: (
                    <>
                        <Bitcoin className="size-5 grower" />
                        <span>${bitcoin.price?.toLocaleString()}</span>
                        <div className="ml-auto flex items-center gap-1 text-sm text-muted">
                            <Box />
                            <span>{bitcoin.block?.toLocaleString()}</span>
                        </div>
                    </>
                ),
            };
            if (textMatches(bitcoinRow, staticFilter)) menuSections.push(rowsSection('bitcoin', [bitcoinRow]));
        }
    }

    if (showUserSearch && matchedPeers.length > 0) {
        menuSections.push(userSection('users', matchedPeers, openUser));
    }

    if (showAllTx && txs.length > 0) {
        menuSections.push({
            key: 'transactions',
            count: txs.length,
            keyFor: (index) => txs[index]?.id || `tx-${index}`,
            select: (index) => {
                const tx = txs[index];
                if (tx) openDialog('txdetails', { tx });
            },
            render: (index, active, onActive, separated) => {
                const tx = txs[index];
                if (!tx) return null;
                const peer = peerByWalletPK.get(tx.peerPK);
                const peerDisplayName = tx.funding ? 'Funded' : tx.withdrawal ? 'Withdrawn' : formatUserDisplay(peer || { walletPK: tx.peerPK }, true);
                return (
                    <MainMenuItem active={active} className={separated && 'shadow-[inset_0_1px_0_0_var(--border)]'} onActive={onActive} onSelect={() => openDialog('txdetails', { tx })}>
                        <Avatar active={tx.funding || tx.withdrawal ? false : peer?.active} bot={!!peer?.bot}>
                            <AvatarImage src={tx.funding || tx.withdrawal ? avatar : peer?.avatar} alt={peerDisplayName} />
                            <AvatarFallback />
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate font-black">{peerDisplayName}</span>
                        <span className="ml-auto flex shrink-0 flex-col items-end leading-none">
                            <span className="text-xs text-muted">{tx.pending ? 'pending' : formatFullDateTime(tx.createdTime)}</span>
                            <span className={`truncate text-xs font-black ${tx.incoming ? 'text-inflow' : 'text-outflow'} ${tx.pending ? 'opacity-50' : ''} ${cloaked ? 'cloaked' : ''}`}>
                                {renderMoney(tx.totalValue, settings?.moneyFormat, bitcoin.price, tx.incoming ? '+' : '-')}
                            </span>
                        </span>
                    </MainMenuItem>
                );
            },
        });
    }

    const menuTotal = countRows(menuSections);
    const menuSignature = menuSections.map((section) => `${section.key}:${section.count}`).join('|');
    const listId = 'mainmenu-list';
    const activeId = menuTotal > 0 && activeIndex >= 0 ? `${listId}-item-${activeIndex}` : '';
    const emptyMessage =
        searching && query?.value ? (
            <Loader className="size-6 animate-spin" />
        ) : showSlashCommands && matchedSlashCommands.length === 0 ? (
            'unknown / command'
        ) : showSlashCommands && typingUsername !== null ? (
            'no users found'
        ) : browseUsers ? (
            'search users'
        ) : showAllTx ? (
            'no transactions'
        ) : (
            'no results'
        );

    useEffect(() => {
        setActiveIndex(menuTotal > 0 ? 0 : -1);
    }, [menuSignature, searchValue, menuTotal]);

    useEffect(() => {
        if (!showAllTx || !hasMoreTxs || isTxLoading || activeIndex < 0 || menuTotal - activeIndex > 20) return;
        void loadMoreTxs?.();
    }, [activeIndex, hasMoreTxs, isTxLoading, loadMoreTxs, menuTotal, showAllTx]);

    const handleMenuKeyDown = (event) => {
        if (event.defaultPrevented || event.nativeEvent?.isComposing) return;
        const textEntry = isEditableTarget(event.target);
        const step = listNavigationStep(event, {
            ignoreEditable: false,
            includeJk: !textEntry,
            includeHorizontal: !textEntry,
        });
        if (step) {
            event.preventDefault();
            setActiveIndex((index) => {
                if (!menuTotal) return -1;
                if (step > 0) return index < 0 ? 0 : (index + 1) % menuTotal;
                return index <= 0 ? menuTotal - 1 : index - 1;
            });
        } else if (event.key === 'Enter') {
            const row = findRow(menuSections, activeIndex);
            if (!row) return;
            event.preventDefault();
            row.section.select?.(row.localIndex);
        }
    };

    return (
        <div className="flex flex-col items-center gap-2" onKeyDown={handleMenuKeyDown}>
            <div className="flex max-h-105 w-lg flex-col overflow-hidden rounded-round bg-background/70 pt-px shadow backdrop-blur-sm">
                <MainMenuInput inputRef={inputRef} listId={listId} activeId={activeId} value={searchValue} onChange={handleSearchChange} onKeyDown={handleInputCompletion} />
                <MainMenuList id={listId} resetKey={menuSignature} sections={menuSections} activeIndex={activeIndex} setActiveIndex={setActiveIndex} empty={emptyMessage} />
            </div>
            {appVersion ? <div className="text-sm font-black text-muted">v{appVersion}</div> : null}
        </div>
    );
}
