import { lowerText } from '@veyl/shared/utils/text';
import { compareProfilesByName } from '@veyl/shared/search/sort';
import { mergeProfiles } from '@veyl/shared/search/merge';
import { completeCommandPrefix, getTypingUsername, matchCommands, parseCommand } from '@veyl/shared/commands';
import { getMsgPreview as displayPreview } from '@veyl/shared/chat/messages';
import { hasAvailableBalance } from '@veyl/shared/wallet/balance';
import { formatUserDisplay } from '@veyl/shared/profile';
import { renderMoney } from '@veyl/shared/money';
import { formatFullDateTime, formatRowDateTime } from '@veyl/shared/utils/time';
import { formatCacheSize } from '@veyl/shared/utils/display';

export const ROW_HEIGHT = 36;
export const LIST_HEIGHT = 384;
export const MIN_RENDER_ROWS = 44;
const MAINMENU_COMMAND_OPTIONS = { mode: 'mainmenu' };

export function textMatches(row, raw) {
    const needle = lowerText(raw);
    if (!needle) return true;
    return [row?.label, row?.value, ...(row?.keywords || [])].some((text) => lowerText(text).includes(needle));
}

export function countRows(sections) {
    return sections.reduce((total, section) => total + (section.count || 0), 0);
}

export function findRow(sections, index) {
    if (index < 0) return null;
    let start = 0;
    for (const section of sections) {
        const count = section.count || 0;
        if (index < start + count) {
            const localIndex = index - start;
            return {
                section,
                localIndex,
                key: section.keyFor?.(localIndex) ?? `${section.key}-${localIndex}`,
            };
        }
        start += count;
    }
    return null;
}

export function getVisibleWindow({
    scrollTop,
    total,
    rowHeight = ROW_HEIGHT,
    listHeight = LIST_HEIGHT,
    minRows = MIN_RENDER_ROWS,
}) {
    if (!total) return { start: 0, end: 0 };

    const visibleRows = Math.max(1, Math.ceil(listHeight / rowHeight));
    const targetRows = Math.min(total, Math.max(visibleRows, minRows));
    const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight));
    let start = Math.max(0, firstVisible - Math.floor((targetRows - visibleRows) / 2));
    let end = Math.min(total, start + targetRows);

    if (end - start < targetRows) {
        start = Math.max(0, end - targetRows);
    }

    return { start, end };
}

export function getOrderedPeers({ peers = [], recentPeers, excludeUid } = {}) {
    const seen = new Set();
    const ordered = [];
    const add = (peer) => {
        if (!peer?.uid || peer.uid === excludeUid || seen.has(peer.uid)) return;
        seen.add(peer.uid);
        ordered.push(peer);
    };

    for (const peer of recentPeers?.all || []) add(peer);

    const remaining = [];
    for (const peer of peers || []) {
        if (peer?.uid && peer.uid !== excludeUid && !seen.has(peer.uid)) {
            remaining.push(peer);
        }
    }
    remaining.sort(compareProfilesByName);
    remaining.forEach(add);

    return ordered;
}

export function getMainMenuSearchState(searchValue, query) {
    const value = String(searchValue || '');
    const showAllTx = value.trim() === '#';
    const showSlashCommands = value.startsWith('/');
    return {
        browseUsers: query?.kind === 'username' && !query.value,
        matchedSlashCommands: showSlashCommands ? matchCommands(value, MAINMENU_COMMAND_OPTIONS) : [],
        parsedSlashCommand: showSlashCommands ? parseCommand(value, MAINMENU_COMMAND_OPTIONS) : null,
        showAllTx,
        showSlashCommands,
        showUserSearch: !!query && !showSlashCommands,
        typingUsername: showSlashCommands ? getTypingUsername(value, MAINMENU_COMMAND_OPTIONS) : null,
    };
}

export function getMainMenuSearchTarget(value) {
    const text = String(value || '');
    if (!text) {
        return '';
    }
    if (!text.startsWith('/')) {
        return text;
    }
    const typing = getTypingUsername(text, MAINMENU_COMMAND_OPTIONS);
    return typing !== null ? `@${typing}` : '';
}

export function completeMainMenuInput(value) {
    return completeCommandPrefix(String(value || ''), MAINMENU_COMMAND_OPTIONS);
}

export function getMainMenuMatchedPeers({ searchState, peers, recentPeers, results, query, uid }) {
    if (!query) return [];
    if (searchState?.browseUsers) {
        return getOrderedPeers({ peers, recentPeers, excludeUid: uid });
    }
    return mergeProfiles({ local: peers || [], remote: results || [], parsed: query, excludeUid: uid });
}

export function getMainMenuTopPeers(recentPeers) {
    return (recentPeers?.all || []).slice(0, 3);
}

export function getMainMenuTransactions(searchState, sortedTransactions) {
    return searchState?.showAllTx ? sortedTransactions || [] : [];
}

function row(action, values) {
    return {
        ...values,
        action,
    };
}

function rowsSection(key, rows) {
    return rows.length ? { key, type: 'rows', rows } : null;
}

function usersSection(key, peers, actionType = 'openUser', extras = {}) {
    const rows = (peers || [])
        .filter((peer) => peer?.uid)
        .map((peer) => ({
            kind: 'user',
            key: peer.uid,
            label: formatUserDisplay(peer, true),
            peer,
            action: { type: actionType, peer, ...extras },
        }));
    return rows.length ? { key, type: 'users', rows } : null;
}

function filterRows(rows, raw) {
    return rows.filter(Boolean).filter((item) => textMatches(item, raw));
}

function addSection(sections, section) {
    if (section?.rows?.length) {
        sections.push(section);
    }
}

function slashCompleteLabel(parsed) {
    if (!parsed?.complete) return '';
    const { username, amount, message } = parsed.args || {};
    return parsed.name === 'msg' ? `msg @${username}: ${message}` : `${parsed.name} ${amount} sats to @${username}`;
}

function slashHintLabel(parsed) {
    const targetUsername = parsed?.args?.username;
    if (!targetUsername) return '';
    if (parsed.name === 'msg') return `send a message to @${targetUsername}`;
    if (parsed.name === 'send') return `send money to @${targetUsername}`;
    if (parsed.name === 'request') return `request money from @${targetUsername}`;
    return '';
}

function buildSlashSections({ searchValue, searchState, matchedPeers }) {
    const sections = [];
    const { matchedSlashCommands, parsedSlashCommand, typingUsername } = searchState;

    if (!searchState.showSlashCommands || matchedSlashCommands.length <= 0) {
        return sections;
    }

    if (parsedSlashCommand?.complete) {
        const label = slashCompleteLabel(parsedSlashCommand);
        addSection(
            sections,
            rowsSection('slash', [
                row(
                    { type: 'runSlash', parsed: parsedSlashCommand },
                    {
                        key: 'slash-execute',
                        kind: 'slash',
                        label: `/${label}`,
                        title: `/${label}`,
                        value: searchValue,
                        keywords: [String(searchValue || '').trim()],
                    }
                ),
            ])
        );
        return sections;
    }

    if (typingUsername !== null && matchedPeers.length > 0) {
        const slashCommand = matchedSlashCommands[0];
        if (slashCommand) {
            addSection(sections, usersSection('slash-users', matchedPeers, 'fillSlashUser', { slashName: slashCommand.name }));
        }
        return sections;
    }

    const hintLabel = slashHintLabel(parsedSlashCommand);
    if (hintLabel) {
        const targetUsername = parsedSlashCommand.args.username;
        addSection(
            sections,
            rowsSection('slash', [
                row(
                    { type: 'runSlash', parsed: parsedSlashCommand },
                    {
                        key: 'slash-hint',
                        kind: 'slash',
                        label: hintLabel,
                        title: hintLabel,
                        value: searchValue,
                        keywords: [String(searchValue || '').trim(), `/${parsedSlashCommand.name} ${targetUsername}`, `/${parsedSlashCommand.name} ${targetUsername} `],
                    }
                ),
            ])
        );
        return sections;
    }

    addSection(
        sections,
        rowsSection(
            'slash',
            matchedSlashCommands.map((slashCommand) =>
                row(
                    { type: 'fillSlashCommand', name: slashCommand.name },
                    {
                        key: slashCommand.name,
                        kind: 'slash',
                        label: slashCommand.name,
                        title: slashCommand.syntax,
                        value: `/${slashCommand.name}`,
                        keywords: ['/', slashCommand.name, searchValue],
                        mono: true,
                    }
                )
            )
        )
    );
    return sections;
}

function chatPreview({ lastChat, peerByChatPK, chatPK, settings, bitcoin, previewNow }) {
    if (!lastChat) return '';
    if (settings?.showChatPreviews === false) return '';
    const profile = peerByChatPK?.get?.(lastChat.peerChatPK) ?? null;
    const displayName = formatUserDisplay(
        {
            username: profile?.username,
            chatPK: lastChat.peerChatPK,
        },
        true
    );
    const lastMessage = displayPreview(lastChat.preview, chatPK, settings, bitcoin?.price, { now: previewNow });
    if (!lastMessage) return displayName;
    const truncatedMessage = lastMessage.length > 24 ? `${lastMessage.slice(0, 24)}...` : lastMessage;
    return `${displayName}: ${truncatedMessage}`;
}

function buildStaticSections(options) {
    const {
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
        peerByChatPK,
        searchValue,
        settings,
        showWalletDot,
        uid,
        username,
    } = options;
    const staticFilter = searchValue;
    const sections = [];
    const hasBalance = !!(balance && balance > 0);

    addSection(
        sections,
        rowsSection(
            'money',
            filterRows(
                [
                    !chatBanned &&
                        row(
                            { type: 'dialog', id: 'newchat' },
                            {
                                key: 'newchat',
                                icon: 'messageCirclePlus',
                                label: 'new chat',
                                keywords: ['message', 'chat', 'dm', 'conversation'],
                                shortcut: 'newchat',
                            }
                        ),
                    hasBalance &&
                        row(
                            { type: 'dialog', id: 'payments', data: { tab: 'send' } },
                            {
                                key: 'sendmoney',
                                icon: 'arrowUpRight',
                                label: 'send money',
                                shortcut: 'sendmoney',
                            }
                        ),
                    row(
                        { type: 'dialog', id: 'payments', data: { tab: 'request' } },
                        {
                            key: 'requestmoney',
                            icon: 'arrowDownLeft',
                            label: 'request money',
                            shortcut: 'requestmoney',
                        }
                    ),
                ],
                staticFilter
            )
        )
    );

    addSection(
        sections,
        rowsSection(
            'views',
            filterRows(
                [
                    !chatBanned &&
                        row(
                            { type: 'route', href: '/chat' },
                            {
                                key: 'chat',
                                icon: 'messageCircle',
                                label: 'chat',
                                dot: hasUnseenChats && !cloaked,
                                subtitle: !cloaked ? chatPreview({ lastChat, peerByChatPK, chatPK, settings, bitcoin }) : '',
                                shortcut: 'chat',
                            }
                        ),
                    row(
                        { type: 'route', href: '/camera' },
                        {
                            key: 'camera',
                            icon: 'camera',
                            label: 'camera',
                            keywords: ['scan', 'qr'],
                            shortcut: 'camera',
                        }
                    ),
                    row(
                        { type: 'route', href: '/wallet' },
                        {
                            key: 'wallet',
                            icon: 'wallet',
                            label: 'dashboard',
                            keywords: ['dashboard', 'overview', 'home', 'wallet'],
                            dot: showWalletDot && !cloaked,
                            subtitle: balance !== null && balance > 0 && !cloaked ? renderMoney(balance, settings?.moneyFormat, bitcoin?.price) : '',
                            shortcut: 'wallet',
                        }
                    ),
                    hasTx &&
                        row(
                            { type: 'route', href: '/transactions' },
                            {
                                key: 'transactions',
                                icon: 'history',
                                label: 'transaction history',
                                keywords: ['transactions', 'history'],
                                shortcut: 'transactions',
                            }
                        ),
                    isAdmin &&
                        row(
                            { type: 'route', href: '/admin/reports' },
                            {
                                key: 'admin',
                                icon: 'hammer',
                                label: 'admin',
                                keywords: ['admin', 'reports', 'moderation'],
                                shortcut: 'admin',
                            }
                        ),
                    isAdmin &&
                        row(
                            { type: 'route', href: '/admin/bots' },
                            {
                                key: 'bot',
                                icon: 'bot',
                                label: 'bot',
                                keywords: ['bot', 'automation', 'reviewer', 'mirror'],
                                shortcut: 'bot',
                            }
                        ),
                ],
                staticFilter
            )
        )
    );

    addSection(
        sections,
        rowsSection(
            'wallet',
            filterRows(
                [
                    row(
                        { type: 'fundingQr' },
                        {
                            key: 'fund',
                            icon: 'banknoteArrowDown',
                            label: 'fund wallet',
                        }
                    ),
                    hasAvailableBalance(balance) &&
                        row(
                            { type: 'dialog', id: 'withdraw' },
                            {
                                key: 'withdraw',
                                icon: 'banknoteArrowUp',
                                label: 'withdraw funds',
                            }
                        ),
                ],
                staticFilter
            )
        )
    );

    addSection(
        sections,
        rowsSection(
            'app',
            filterRows(
                [
                    row(
                        { type: 'dialog', id: 'settings' },
                        {
                            key: 'settings',
                            icon: 'settings2',
                            label: 'settings',
                            keywords: ['change', 'currency', 'lock', 'profile', 'preferences', 'avatar'],
                            shortcut: 'settings',
                        }
                    ),
                    searchValue &&
                        username &&
                        row(
                            { type: 'inviteLink' },
                            {
                                key: 'invite-link',
                                icon: 'userPlus',
                                label: 'invite a friend',
                                keywords: ['invite', 'share', 'copy', 'join', 'friend', 'link', 'veyl'],
                            }
                        ),
                    (hasChats || hasTx) &&
                        row(
                            { type: 'cloak' },
                            {
                                key: 'cloak',
                                icon: cloaked ? 'eyeOff' : 'eye',
                                label: cloaked ? 'uncloak' : 'cloak',
                                keywords: ['cloak', 'uncloak', 'hide', 'vision', 'privacy', 'view', 'show'],
                                shortcut: 'cloak',
                            }
                        ),
                    row(
                        { type: 'clearCache' },
                        {
                            key: 'clear-cache',
                            icon: 'trash2',
                            label: 'clear cache',
                            keywords: ['cache', 'clear', 'delete', 'storage'],
                            trailing: formatCacheSize(cacheSize),
                        }
                    ),
                ],
                staticFilter
            )
        )
    );

    addSection(
        sections,
        rowsSection(
            'session',
            filterRows(
                [
                    row(
                        { type: 'lock' },
                        {
                            key: 'lock',
                            icon: 'lock',
                            label: 'lock vault',
                            shortcut: 'lock',
                        }
                    ),
                    row(
                        { type: 'dialog', id: 'rememberaccount', data: { user: { uid, username, avatar } } },
                        {
                            key: 'logout',
                            icon: 'logOut',
                            label: 'logout',
                            shortcut: 'logout',
                        }
                    ),
                ],
                staticFilter
            )
        )
    );

    addSection(
        sections,
        rowsSection(
            'account',
            filterRows(
                [
                    row(
                        { type: 'dialog', id: 'deleteaccount' },
                        {
                            key: 'delete-account',
                            icon: 'trash2',
                            label: 'delete account',
                            className: 'text-destructive',
                        }
                    ),
                ],
                staticFilter
            )
        )
    );

    if (searchValue && bitcoin) {
        const bitcoinRow = row(
            { type: 'external', href: 'https://mempool.space/' },
            {
                key: 'bitcoin',
                icon: 'bitcoin',
                label: 'bitcoin',
                title: `$${bitcoin.price?.toLocaleString()}`,
                keywords: ['btc', 'price', 'mempool', 'block'],
                trailingIcon: 'box',
                trailing: bitcoin.block?.toLocaleString(),
            }
        );
        if (textMatches(bitcoinRow, staticFilter)) {
            addSection(sections, rowsSection('bitcoin', [bitcoinRow]));
        }
    }

    return sections;
}

function buildTransactionRows({ avatar, bitcoin, cloaked, peerByWalletPK, rowTimeNow, settings, txs }) {
    return (txs || []).map((tx, index) => {
        const peer = peerByWalletPK?.get?.(tx.peerPK);
        const displayName = tx.funding ? 'Funded' : tx.withdrawal ? 'Withdrawn' : formatUserDisplay(peer || { walletPK: tx.peerPK }, true);
        return {
            kind: 'transaction',
            key: tx?.id || `tx-${index}`,
            tx,
            peer,
            displayName,
            avatarSrc: tx.funding || tx.withdrawal ? avatar : peer?.avatar,
            active: tx.funding || tx.withdrawal ? false : peer?.active,
            bot: !!peer?.bot,
            status: tx.pending ? 'pending' : formatRowDateTime(tx.createdTime, rowTimeNow),
            exactTitle: tx.pending ? '' : formatFullDateTime(tx.createdTime),
            amount: renderMoney(tx.totalValue, settings?.moneyFormat, bitcoin?.price, tx.incoming ? '+' : '-'),
            amountClassName: `${tx.incoming ? 'text-inflow' : 'text-outflow'} ${tx.pending ? 'opacity-50' : ''} ${cloaked ? 'cloaked' : ''}`,
            action: { type: 'txdetails', tx },
        };
    });
}

export function buildMainMenuModel(options) {
    const { matchedPeers = [], searchState, searchValue, topPeers = [], txs = [] } = options;
    const sections = [];

    for (const section of buildSlashSections({ searchValue, searchState, matchedPeers })) {
        addSection(sections, section);
    }

    if (!searchValue && topPeers.length > 0) {
        addSection(sections, usersSection('top-users', topPeers));
    }

    if (!searchState.showSlashCommands && !searchState.showUserSearch && !searchState.showAllTx) {
        for (const section of buildStaticSections(options)) {
            addSection(sections, section);
        }
    }

    if (searchState.showUserSearch && matchedPeers.length > 0) {
        addSection(sections, usersSection('users', matchedPeers));
    }

    if (searchState.showAllTx && txs.length > 0) {
        addSection(sections, { key: 'transactions', type: 'transactions', rows: buildTransactionRows(options) });
    }

    return sections;
}

export function getMainMenuEmptyState({ query, searchState, searching }) {
    if (searching && query?.value) return { type: 'loading' };
    if (searchState.showSlashCommands && searchState.matchedSlashCommands.length === 0) return { type: 'text', text: 'unknown / command' };
    if (searchState.showSlashCommands && searchState.typingUsername !== null) return { type: 'text', text: 'no users found' };
    if (searchState.browseUsers) return { type: 'text', text: 'search users' };
    if (searchState.showAllTx) return { type: 'text', text: 'no transactions' };
    return { type: 'text', text: 'no results' };
}

export function getMenuSignature(sections) {
    return (sections || []).map((section) => `${section.key}:${section.count ?? section.rows?.length ?? 0}`).join('|');
}
