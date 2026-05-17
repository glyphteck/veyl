import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandSeparator, CommandShortcut, CommandEmpty } from '@/components/command';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '@/components/providers/dialogprovider';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { mergeProfiles } from '@glyphteck/shared/search/merge';
import { sortProfiles } from '@glyphteck/shared/search/sort';
import { getTypingUsername, matchCommands, parseCommand, parseCommandAmountSats } from '@glyphteck/shared/commands';
import { useChat } from '@/components/providers/chatprovider';
import { formatUserDisplay, renderMoney, formatFullDateTime } from '@/lib/utils';
import { useSearch } from '@/lib/search/usesearch';
import { shortcuts } from '@/lib/shortcuts';
import { Bitcoin } from '@/components/bitcoin';
import { getMsgPreview as displayLastMsg, makeReq, makeTxt } from '@glyphteck/shared/chat/messages';
import { Dot } from '@/components/dot';
import { qr } from '@glyphteck/shared/qrutils';
import { getChatId } from '@glyphteck/shared/crypto/chat';
import { minWithdrawalSats } from '@glyphteck/shared/spark';

function formatCacheSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function MainMenu({ close, data }) {
    const router = useRouter();
    const { openDialog } = useDialog();
    const { uid, username, settings, chatPK, chatBanned, isAdmin, avatar, walletPK } = useUser();
    const { copyFundingAddress, sendMoneyWithSpark, balance, bitcoin } = useWallet();
    const { lock, localCache } = useVault();
    const { hasTx, transactions } = useTxData();
    const { hasChats, lastChat, chats, sendMessage, selectChat } = useChat();
    const { peers, recentPeers, addPeer } = usePeer();
    const { cloaked, cloak } = useCloak();
    const { searching, results, query, search, clearSearch } = useSearch('mainmenu');
    const [searchValue, setSearchValue] = useState(data?.searchInput || '');
    const [cacheSize, setCacheSize] = useState(0);
    const inputRef = useRef(null);
    const clearingCacheRef = useRef(false);
    const hasBalance = balance && balance > 0;
    const hasUnseenChats = !!chats?.some((c) => c?.unseen);
    const showWalletDot = false;
    const showAllTx = searchValue.trim() === '#';
    const browseUsers = query?.kind === 'username' && !query.value;
    const showCommands = searchValue.startsWith('/');
    const showUserSearch = !!query && !showCommands;
    const matchedCommands = showCommands ? matchCommands(searchValue, { mode: 'mainmenu' }) : [];
    const parsedCommand = showCommands ? parseCommand(searchValue, { mode: 'mainmenu' }) : null;
    const typingUsername = showCommands ? getTypingUsername(searchValue, { mode: 'mainmenu' }) : null;

    const executeCommand = async (parsed) => {
        if (!parsed?.complete) return;
        let peer =
            [...(peers || []), ...(results || [])].find((p) => {
                if (!p?.username || !parsed.args.username) return false;
                return p.username.toLowerCase() === parsed.args.username.toLowerCase();
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
                toast.error('missing wallet key');
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
                icon: <Loader className="animate-spin size-4" />,
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
                toast.error('missing chat key');
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
                toast.error('missing chat key');
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
    // if search value passed on mount
    useEffect(() => {
        if (searchValue) handleSearchChange(searchValue);
    }, []);

    // go to end of input if search value on open
    useEffect(() => {
        if (data?.searchInput && inputRef.current) {
            queueMicrotask(() => {
                const input = inputRef.current;
                if (input) {
                    input.setSelectionRange(input.value.length, input.value.length);
                }
            });
        }
    }, [data?.searchInput]);

    useEffect(() => {
        let cancelled = false;
        if (!localCache?.estimateSize) {
            setCacheSize(0);
            return;
        }
        localCache.estimateSize().then((size) => {
            if (!cancelled) {
                setCacheSize(Number(size) || 0);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [localCache]);

    const peerMap = useMemo(() => {
        const map = new Map();
        peers?.forEach((peer) => {
            if (peer.walletPK) {
                map.set(peer.walletPK, peer);
            }
        });
        return map;
    }, [peers]);

    const topPeers = (recentPeers?.all || []).slice(0, 3);
    const matchedPeers = useMemo(() => {
        if (!query) return [];
        if (browseUsers) {
            return sortProfiles(
                (peers || []).filter((peer) => peer?.uid && peer.uid !== uid),
                query
            );
        }
        return mergeProfiles({ local: peers || [], remote: results || [], parsed: query, excludeUid: uid });
    }, [browseUsers, peers, query, results, uid]);

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

    return (
        <div className="flex flex-col items-center gap-2">
            <Command className="w-lg max-h-105 pt-px">
                <CommandInput ref={inputRef} placeholder="search for anything" value={searchValue} onValueChange={handleSearchChange} />
                <CommandList>
                {searching && query?.value && (
                    <CommandEmpty>
                        <Loader className="animate-spin size-6" />
                    </CommandEmpty>
                )}
                {!searching && searchValue && (
                    <CommandEmpty>
                        {showCommands && matchedCommands.length === 0
                            ? 'unknown command'
                            : showCommands && typingUsername !== null
                              ? 'no users found'
                              : browseUsers
                                ? 'search users'
                                : showAllTx
                                  ? 'no transactions'
                                  : 'no results'}
                    </CommandEmpty>
                )}
                {/* commands */}
                {showCommands && matchedCommands.length > 0 && (
                    <>
                        <CommandGroup heading="commands">
                            {parsedCommand?.complete
                                ? (() => {
                                      const { username, amount, message } = parsedCommand.args;
                                      const label = parsedCommand.name === 'msg' ? `msg @${username}: ${message}` : `${parsedCommand.name} ${amount} sats to @${username}`;
                                      return (
                                          <CommandItem key="cmd-execute" value={`/${label}`} keywords={[searchValue, searchValue.trim()]} onSelect={() => executeCommand(parsedCommand)}>
                                              <span>/{label}</span>
                                          </CommandItem>
                                      );
                                  })()
                                : typingUsername !== null
                                  ? matchedPeers.map((peer) => (
                                        <CommandItem
                                            key={peer.uid}
                                            value={`@${peer.username}`}
                                            keywords={[searchValue]}
                                            onSelect={() => {
                                                const cmd = matchedCommands[0];
                                                const next = `/${cmd.name} @${peer.username} `;
                                                setSearchValue(next);
                                                handleSearchChange(next);
                                                setTimeout(() => inputRef.current?.focus(), 0);
                                            }}
                                        >
                                            <Avatar active={peer?.active} bot={!!peer?.bot}>
                                                <AvatarImage src={peer.avatar} alt={peer.username || 'user'} />
                                                <AvatarFallback />
                                            </Avatar>
                                            <span>{formatUserDisplay(peer, true)}</span>
                                        </CommandItem>
                                    ))
                                  : parsedCommand?.args?.username
                                    ? (() => {
                                          const { username } = parsedCommand.args;
                                          const hintLabel =
                                              parsedCommand.name === 'msg'
                                                  ? `send a message to @${username}`
                                                  : parsedCommand.name === 'send'
                                                    ? `send money to @${username}`
                                                    : parsedCommand.name === 'request'
                                                      ? `request money from @${username}`
                                                      : null;
                                          return hintLabel ? (
                                              <CommandItem
                                                  key="cmd-hint"
                                                  value={hintLabel}
                                                  keywords={[searchValue, searchValue.trim(), `/${parsedCommand.name} ${username}`, `/${parsedCommand.name} ${username} `]}
                                                  onSelect={() => executeCommand(parsedCommand)}
                                              >
                                                  <span>{hintLabel}</span>
                                              </CommandItem>
                                          ) : null;
                                      })()
                                    : matchedCommands.map((cmd) => (
                                          <CommandItem
                                              key={cmd.name}
                                              value={`/${cmd.name}`}
                                              keywords={['/', 'command', cmd.name, searchValue]}
                                              onSelect={() => {
                                                  const next = `/${cmd.name} @`;
                                                  setSearchValue(next);
                                                  handleSearchChange(next);
                                                  setTimeout(() => inputRef.current?.focus(), 0);
                                              }}
                                          >
                                              <span className="font-mono">{cmd.syntax}</span>
                                          </CommandItem>
                                      ))}
                        </CommandGroup>
                        <CommandSeparator />
                    </>
                )}
                {/* top peers */}
                {!searchValue && topPeers.length > 0 && (
                    <>
                        <CommandGroup heading="users">
                            {topPeers.map((peer) => (
                                <CommandItem key={peer.uid} value={`@${peer.username}`} onSelect={() => openDialog('userdetails', { user: peer })} keywords={['']}>
                                    <Avatar active={peer?.active} bot={!!peer?.bot}>
                                        <AvatarImage src={peer.avatar} alt={peer.username || 'user'} />
                                        <AvatarFallback />
                                    </Avatar>
                                    <span>{formatUserDisplay(peer, true)}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                        <CommandSeparator />
                    </>
                )}
                <CommandGroup heading="money actions">
                    {!chatBanned && (
                        <CommandItem onSelect={() => openDialog('newchat')} keywords={['message', 'chat', 'dm', 'conversation']}>
                            <MessageCirclePlus />
                            <span>new chat</span>
                            <CommandShortcut>{shortcuts.newchat}</CommandShortcut>
                        </CommandItem>
                    )}
                    {hasBalance ? (
                        <CommandItem onSelect={() => openDialog('payments', { tab: 'send' })}>
                            <ArrowUpRight />
                            <span>send money</span>
                            <CommandShortcut>{shortcuts.sendmoney}</CommandShortcut>
                        </CommandItem>
                    ) : null}
                    <CommandItem onSelect={() => openDialog('payments', { tab: 'request' })}>
                        <ArrowDownLeft />
                        <span>request money</span>
                        <CommandShortcut>{shortcuts.requestmoney}</CommandShortcut>
                    </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="views">
                    {!chatBanned && (
                        <CommandItem onSelect={() => openRoute('/chat')}>
                            <Dot show={hasUnseenChats && !cloaked} compact>
                                <MessageCircle />
                            </Dot>
                            <span className="flex items-center gap-2">
                                <span>chat</span>
                                {lastChat && !cloaked && (
                                    <span className="text-muted ">
                                        {(() => {
                                            const profile = peers?.find((peer) => peer.chatPK === lastChat.peerChatPK) ?? null;
                                            const displayName = formatUserDisplay(
                                                {
                                                    username: profile?.username,
                                                    walletPK: lastChat.peerChatPK,
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
                            <CommandShortcut>{shortcuts.chat}</CommandShortcut>
                        </CommandItem>
                    )}
                    <CommandItem onSelect={() => openRoute('/camera')} keywords={['camera', 'scan', 'qr']}>
                        <Camera />
                        <span>camera</span>
                        <CommandShortcut>{shortcuts.camera}</CommandShortcut>
                    </CommandItem>
                    <CommandItem onSelect={() => openRoute('/wallet')} keywords={['dashboard', 'overview', 'home', 'wallet']}>
                        <Dot show={showWalletDot && !cloaked} compact>
                            <Wallet />
                        </Dot>
                        <span className="flex items-center gap-2">
                            <span>dashboard</span>
                            {balance !== null && balance > 0 && !cloaked && <span className="text-muted">{renderMoney(balance, settings?.moneyFormat, bitcoin.price)}</span>}
                        </span>
                        <CommandShortcut>{shortcuts.wallet}</CommandShortcut>
                    </CommandItem>
                    {hasTx ? (
                        <CommandItem onSelect={() => openRoute('/transactions')}>
                            <History />
                            <span>transaction history</span>
                            <CommandShortcut>{shortcuts.transactions}</CommandShortcut>
                        </CommandItem>
                    ) : null}
                    {isAdmin ? (
                        <>
                            <CommandItem onSelect={() => openRoute('/admin/reports')} keywords={['admin', 'reports', 'moderation']}>
                                <Hammer />
                                <span>admin</span>
                                <CommandShortcut>{shortcuts.admin}</CommandShortcut>
                            </CommandItem>
                            <CommandItem onSelect={() => openRoute('/admin/bots')} keywords={['bot', 'automation', 'reviewer', 'mirror']}>
                                <Bot />
                                <span>bot</span>
                                <CommandShortcut>{shortcuts.bot}</CommandShortcut>
                            </CommandItem>
                        </>
                    ) : null}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="wallet actions">
                    <CommandItem
                        onSelect={async () => {
                            close();
                            const address = await copyFundingAddress();
                            if (address) {
                                openDialog('qrcode', { type: qr.bitcoin, value: address });
                            }
                        }}
                    >
                        <BanknoteArrowDown />
                        <span>fund wallet</span>
                    </CommandItem>
                    {balance != null && balance >= minWithdrawalSats && (
                        <CommandItem onSelect={() => openDialog('withdraw')}>
                            <BanknoteArrowUp />
                            <span>withdraw funds</span>
                        </CommandItem>
                    )}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="app">
                    <CommandItem keywords={['change', 'currency', 'lock', 'profile', 'preferences', 'avatar']} onSelect={() => openDialog('settings')}>
                        <Settings2 />
                        <span>settings</span>
                        <CommandShortcut>{shortcuts.settings}</CommandShortcut>
                    </CommandItem>
                    {(hasChats || hasTx) && (
                        <CommandItem
                            onSelect={() => {
                                close();
                                cloak();
                            }}
                            keywords={['cloak', 'uncloak', 'hide', 'vision', 'privacy', 'view', 'show']}
                        >
                            {cloaked ? <EyeOff /> : <Eye />}
                            <span>{cloaked ? 'uncloak' : 'cloak'}</span>
                            <CommandShortcut>{shortcuts.cloak}</CommandShortcut>
                        </CommandItem>
                    )}
                    <CommandItem onSelect={clearCache} keywords={['cache', 'clear', 'delete', 'storage']}>
                        <Trash2 />
                        <span>clear cache</span>
                        <span className="ml-auto text-sm text-muted">{formatCacheSize(cacheSize)}</span>
                    </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="session">
                    <CommandItem onSelect={() => lock()}>
                        <Lock />
                        <span>lock vault</span>
                        <CommandShortcut>{shortcuts.lock}</CommandShortcut>
                    </CommandItem>
                    <CommandItem onSelect={() => openDialog('rememberaccount', { user: { uid, username, avatar } })}>
                        <LogOut />
                        <span>logout</span>
                        <CommandShortcut>{shortcuts.logout}</CommandShortcut>
                    </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="account">
                    <CommandItem className="text-destructive" onSelect={() => openDialog('deleteaccount')}>
                        <Trash2 />
                        <span>delete account</span>
                    </CommandItem>
                </CommandGroup>
                {/* peers */}
                {showUserSearch && matchedPeers.length > 0 && (
                    <>
                        <CommandGroup heading="users">
                            {matchedPeers.map((peer) => (
                                <CommandItem
                                    key={peer.uid}
                                    value={`@${peer.username}`}
                                    onSelect={() => openDialog('userdetails', { user: peer })}
                                    keywords={query?.kind === 'role' ? [query.role] : ['']}
                                >
                                    <Avatar active={peer?.active} bot={!!peer?.bot}>
                                        <AvatarImage src={peer.avatar} alt={peer.username || 'User'} />
                                        <AvatarFallback />
                                    </Avatar>
                                    <span>{formatUserDisplay(peer, true)}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )}
                {/* transactions */}
                {showAllTx && transactions.length > 0 && (
                    <>
                        <CommandGroup heading="transactions">
                            {transactions.map((tx) => {
                                const peer = peerMap.get(tx.peerPK);
                                const peerDisplayName = tx.funding ? 'Funded' : tx.withdrawal ? 'Withdrawn' : formatUserDisplay(peer || { walletPK: tx.peerPK }, true);
                                return (
                                    <CommandItem
                                        key={tx.id}
                                        value={`# ${tx.id} ${renderMoney(tx.totalValue, settings?.moneyFormat, bitcoin.price)} ${tx.incoming ? 'received' : 'sent'} ${
                                            tx.pending ? 'pending' : 'completed'
                                        } ${peerDisplayName}`}
                                        onSelect={() => openDialog('txdetails', { tx })}
                                        keywords={['transactions', '#']}
                                    >
                                        <Avatar active={tx.funding || tx.withdrawal ? false : peer?.active} bot={!!peer?.bot}>
                                            <AvatarImage src={tx.funding || tx.withdrawal ? avatar : peer?.avatar} alt={peerDisplayName} />
                                            <AvatarFallback />
                                        </Avatar>
                                        <span className="flex items-center gap-2">
                                            <span className={`font-black ${tx.incoming ? 'text-inflow' : 'text-outflow'} ${tx.pending ? 'opacity-50' : ''} ${cloaked ? 'cloaked' : ''}`}>
                                                {renderMoney(tx.totalValue, settings?.moneyFormat, bitcoin.price, tx.incoming ? '+' : '-')}
                                            </span>
                                            {peerDisplayName && <span className="text-muted">{peerDisplayName}</span>}
                                        </span>
                                        <div className="ml-auto text-sm text-muted">{formatFullDateTime(tx.createdTime)}</div>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </>
                )}
                {/* bitcoin data */}
                {searchValue && bitcoin && (
                    <>
                        <CommandGroup heading="bitcoin">
                            <CommandItem
                                value="bitcoin"
                                keywords={['btc', 'price', 'mempool', 'block']}
                                onSelect={() => {
                                    close();
                                    window.open('https://mempool.space/', '_blank');
                                }}
                            >
                                <Bitcoin className="size-5 grower" />
                                <span>${bitcoin.price?.toLocaleString()}</span>
                                <div className="ml-auto flex items-center gap-1 text-sm text-muted">
                                    <Box />
                                    <span>{bitcoin.block?.toLocaleString()}</span>
                                </div>
                            </CommandItem>
                        </CommandGroup>
                    </>
                )}
                </CommandList>
            </Command>
            {appVersion ? <div className="text-sm font-black text-muted">v{appVersion}</div> : null}
        </div>
    );
}
