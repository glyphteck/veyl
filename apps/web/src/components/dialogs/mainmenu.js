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
    UserPlus,
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
import { sameText } from '@veyl/shared/utils/text';
import { parseCommandAmountSats } from '@veyl/shared/commands';
import { useChat } from '@/components/providers/chatprovider';
import { cn } from '@/lib/classes';
import { formatUserDisplay } from '@veyl/shared/profile';
import { useRowDateTimeNow } from '@veyl/shared/utils/userowdatetime';
import { renderMoney } from '@veyl/shared/money';
import {
    LIST_HEIGHT,
    ROW_HEIGHT,
    buildMainMenuModel,
    completeMainMenuInput,
    countRows,
    findRow,
    getMainMenuEmptyState,
    getMainMenuMatchedPeers,
    getMainMenuSearchState,
    getMainMenuSearchTarget,
    getMainMenuTopPeers,
    getMainMenuTransactions,
    getMenuSignature,
    getVisibleWindow,
} from '@/lib/mainmenu';
import { useSearch } from '@/lib/search/usesearch';
import { shortcuts } from '@/lib/shortcuts';
import { isEditableTarget, listNavigationStep } from '@/lib/focus';
import { Bitcoin } from '@/components/bitcoin';
import { makeReq, makeTxt } from '@veyl/shared/chat/messages';
import { Dot } from '@/components/dot';
import { qr } from '@veyl/shared/qr';
import { invite, makeInviteLink } from '@veyl/shared/invite';
import { Shortcut } from '@/components/shortcut';

const ROW_ICONS = {
    arrowDownLeft: ArrowDownLeft,
    arrowUpRight: ArrowUpRight,
    banknoteArrowDown: BanknoteArrowDown,
    banknoteArrowUp: BanknoteArrowUp,
    bot: Bot,
    box: Box,
    camera: Camera,
    eye: Eye,
    eyeOff: EyeOff,
    hammer: Hammer,
    history: History,
    lock: Lock,
    logOut: LogOut,
    messageCircle: MessageCircle,
    messageCirclePlus: MessageCirclePlus,
    settings2: Settings2,
    trash2: Trash2,
    userPlus: UserPlus,
    wallet: Wallet,
};

function renderIcon(name) {
    if (name === 'bitcoin') {
        return <Bitcoin className="size-5 grower" />;
    }
    const Icon = ROW_ICONS[name];
    return Icon ? <Icon /> : null;
}

function rowsSection(section, selectAction) {
    const rows = section.rows || [];
    return {
        key: section.key,
        count: rows.length,
        keyFor: (index) => rows[index]?.key,
        select: (index) => selectAction(rows[index]?.action),
        render: (index, active, onActive, separated) => {
            const row = rows[index];
            if (!row) return null;
            return (
                <MainMenuRow row={row} active={active} separated={separated} onActive={onActive} onSelect={() => selectAction(row.action)} />
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

function MainMenuItem({ active, className, children, onActive, onSelect, title }) {
    return (
        <button
            type="button"
            tabIndex={-1}
            title={title || undefined}
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
    return <Shortcut className={className} {...props} />;
}

function MainMenuRowContent({ row }) {
    if (row.kind === 'user') {
        const peer = row.peer;
        return (
            <>
                <Avatar active={peer?.active} bot={!!peer?.bot}>
                    <AvatarImage src={peer?.avatar} alt={row.label || peer?.username || 'user'} />
                    <AvatarFallback />
                </Avatar>
                <span>{row.label}</span>
            </>
        );
    }

    if (row.kind === 'transaction') {
        return (
            <>
                <Avatar active={row.active} bot={row.bot}>
                    <AvatarImage src={row.avatarSrc} alt={row.displayName} />
                    <AvatarFallback />
                </Avatar>
                <span className="min-w-0 flex-1 truncate font-black">{row.displayName}</span>
                <span className="ml-auto flex shrink-0 flex-col items-end leading-none">
                    <span className="text-xs text-muted">{row.status}</span>
                    <span className={cn('truncate text-xs font-black', row.amountClassName)}>{row.amount}</span>
                </span>
            </>
        );
    }

    if (row.mono) {
        return <span className="font-mono">{row.title || row.label}</span>;
    }

    const icon = renderIcon(row.icon);
    const trailingIcon = renderIcon(row.trailingIcon);
    const label = row.title || row.label;

    return (
        <>
            {row.dot !== undefined ? (
                <Dot show={!!row.dot} compact>
                    {icon}
                </Dot>
            ) : (
                icon
            )}
            {row.subtitle ? (
                <span className="flex min-w-0 items-center gap-2">
                    <span>{label}</span>
                    <span className="truncate text-muted">{row.subtitle}</span>
                </span>
            ) : (
                <span>{label}</span>
            )}
            {row.shortcut ? <MainMenuShortcut>{shortcuts[row.shortcut]}</MainMenuShortcut> : null}
            {row.trailing ? (
                trailingIcon ? (
                    <div className="ml-auto flex items-center gap-1 text-sm text-muted">
                        {trailingIcon}
                        <span>{row.trailing}</span>
                    </div>
                ) : (
                    <span className="ml-auto text-sm text-muted">{row.trailing}</span>
                )
            ) : null}
        </>
    );
}

function MainMenuRow({ row, active, separated, onActive, onSelect }) {
    return (
        <MainMenuItem active={active} className={cn(separated && 'shadow-[inset_0_1px_0_0_var(--border)]', row.className)} onActive={onActive} onSelect={onSelect} title={row.exactTitle}>
            <MainMenuRowContent row={row} />
        </MainMenuItem>
    );
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
    const { hasChats, lastChat, chats, previewNow, sendMessage, selectPeerChat } = useChat();
    const { peers, recentPeers, peerByWalletPK, peerByChatPK, addPeer } = usePeer();
    const { cloaked, cloak } = useCloak();
    const { searching, results, query, search, clearSearch } = useSearch('mainmenu');
    const [searchValue, setSearchValue] = useState(data?.searchInput || '');
    const [activeIndex, setActiveIndex] = useState(0);
    const [cacheSize, setCacheSize] = useState(0);
    const inputRef = useRef(null);
    const clearingCacheRef = useRef(false);
    const cacheRefreshRef = useRef(0);
    const hasUnseenChats = !!chats?.some((c) => c?.unseen);
    const showWalletDot = false;
    const searchState = useMemo(() => getMainMenuSearchState(searchValue, query), [query, searchValue]);
    const topPeers = useMemo(() => getMainMenuTopPeers(recentPeers), [recentPeers]);
    const matchedPeers = useMemo(
        () => getMainMenuMatchedPeers({ searchState, peers, recentPeers, results, query, uid }),
        [peers, query, recentPeers, results, searchState, uid]
    );
    const txs = useMemo(() => getMainMenuTransactions(searchState, sortedTransactions), [searchState, sortedTransactions]);
    const txTimes = useMemo(() => txs.map((tx) => tx.createdTime), [txs]);
    const rowTimeNow = useRowDateTimeNow(txTimes);

    const openUser = useCallback(
        (peer) => {
            openDialog(peer?.uid && peer.uid === uid ? 'settings' : 'userdetails', peer?.uid && peer.uid === uid ? null : { user: peer });
        },
        [openDialog, uid]
    );

    const openFundingQr = async () => {
        close();
        const address = fundingAddress || (await getFundingAddress());
        if (!address) return;
        openDialog('qrcode', { type: qr.bitcoin, value: address });
        void copyFundingAddress(address).catch(() => {});
    };

    const copyInviteLink = async () => {
        const link = makeInviteLink({ kind: invite.join, from: username });
        if (!link) {
            toast.error('invite unavailable');
            return;
        }
        try {
            await navigator.clipboard.writeText(link);
            close();
            toast('invite link copied');
        } catch (error) {
            console.error('invite link copy failed', error);
            toast.error('could not copy invite link');
        }
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
            close();
            await selectPeerChat(peer.chatPK);
            router.push('/chat');
            void sendMessage(peer.chatPK, makeTxt(parsed.args.message)).catch((error) => {
                console.error('mainmenu msg failed', error);
            });
        }
    };

    const handleSearchChange = (value) => {
        setSearchValue(value);
        const target = getMainMenuSearchTarget(value);
        if (!target) {
            clearSearch();
            return;
        }
        search(target);
    };

    const handleInputCompletion = (event) => {
        if (event.key !== 'Tab' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        const next = completeMainMenuInput(searchValue);
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

    const handleAction = (action) => {
        if (!action) return;
        if (action.type === 'dialog') {
            openDialog(action.id, action.data);
        } else if (action.type === 'route') {
            openRoute(action.href);
        } else if (action.type === 'fundingQr') {
            void openFundingQr();
        } else if (action.type === 'inviteLink') {
            void copyInviteLink();
        } else if (action.type === 'clearCache') {
            void clearCache();
        } else if (action.type === 'cloak') {
            close();
            cloak();
        } else if (action.type === 'lock') {
            lock();
        } else if (action.type === 'external') {
            close();
            window.open(action.href, '_blank');
        } else if (action.type === 'txdetails') {
            openDialog('txdetails', { tx: action.tx });
        } else if (action.type === 'openUser') {
            openUser(action.peer);
        } else if (action.type === 'fillSlashCommand') {
            handleSearchChange(`/${action.name} @`);
            focusInput();
        } else if (action.type === 'fillSlashUser') {
            if (!action.slashName || !action.peer?.username) return;
            handleSearchChange(`/${action.slashName} @${action.peer.username} `);
            focusInput();
        } else if (action.type === 'runSlash') {
            void runSlashCommand(action.parsed);
        }
    };

    const modelSections = buildMainMenuModel({
        avatar,
        balance,
        bitcoin,
        cacheSize,
        chatBanned,
        chatPK,
        cloaked,
        hasChats,
        hasTx,
        hasUnseenChats,
        isAdmin,
        lastChat,
        matchedPeers,
        peerByChatPK,
        peerByWalletPK,
        previewNow,
        rowTimeNow,
        searchState,
        searchValue,
        settings,
        showWalletDot,
        topPeers,
        txs,
        uid,
        username,
    });
    const menuSections = modelSections.map((section) => rowsSection(section, handleAction));
    const menuTotal = countRows(menuSections);
    const menuSignature = getMenuSignature(modelSections);
    const listId = 'mainmenu-list';
    const activeId = menuTotal > 0 && activeIndex >= 0 ? `${listId}-item-${activeIndex}` : '';
    const emptyState = getMainMenuEmptyState({ query, searchState, searching });
    const emptyMessage = emptyState.type === 'loading' ? <Loader className="size-6 animate-spin" /> : emptyState.text;

    useEffect(() => {
        setActiveIndex(menuTotal > 0 ? 0 : -1);
    }, [menuSignature, searchValue, menuTotal]);

    useEffect(() => {
        if (!searchState.showAllTx || !hasMoreTxs || isTxLoading || activeIndex < 0 || menuTotal - activeIndex > 20) return;
        void loadMoreTxs?.();
    }, [activeIndex, hasMoreTxs, isTxLoading, loadMoreTxs, menuTotal, searchState.showAllTx]);

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
