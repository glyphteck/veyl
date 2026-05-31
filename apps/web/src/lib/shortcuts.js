export const shortcuts = {
    mainmenu: '⌘K',
    newchat: '⌘N',
    chat: '⌘1',
    camera: '⌘2',
    wallet: '⌘3',
    transactions: '⌘4',
    admin: '⌘5',
    bot: '⌘6',
    settings: '⌘,',
    lock: '⌘L',
    logout: '⌘⇧L',
    user: '⌘U',
    userqr: '⌘⇧U',
    sendmoney: '⌘S',
    requestmoney: '⌘D',
    cloak: '⌘H',
};

function isAccel(event) {
    return event.ctrlKey || event.metaKey;
}

export function handleAppShortcut(event, options) {
    if (!isAccel(event)) {
        return false;
    }

    const key = event.key.toLowerCase();
    const { pathname, openDialog, push, lock, logout, cloak, openUserMenu, openUserQr, hasTx, isAdmin, chatBanned } = options;

    if (event.shiftKey && /^Digit[0-9]$/.test(event.code || '')) {
        return false;
    }

    if (key === 'k') {
        event.preventDefault();
        openDialog('mainmenu');
        return true;
    }

    if (key === 'n') {
        event.preventDefault();
        if (!chatBanned) {
            openDialog('newchat');
        }
        return true;
    }

    if (key === '1') {
        event.preventDefault();
        if (!chatBanned) {
            if (pathname?.startsWith('/chat')) {
                openDialog('newchat');
            } else {
                push('/chat');
            }
        }
        return true;
    }

    if (key === '2') {
        event.preventDefault();
        push('/camera');
        return true;
    }

    if (key === '3') {
        event.preventDefault();
        push('/wallet');
        return true;
    }

    if (key === '4') {
        event.preventDefault();
        if (hasTx) {
            push('/transactions');
        }
        return true;
    }

    if (key === '5') {
        event.preventDefault();
        if (isAdmin) {
            push('/admin/reports');
        }
        return true;
    }

    if (key === '6') {
        event.preventDefault();
        if (isAdmin) {
            push('/admin/bots');
        }
        return true;
    }

    if (key === ',') {
        if (event.shiftKey) {
            return false;
        }
        event.preventDefault();
        openDialog('settings');
        return true;
    }

    if (key === 'l') {
        event.preventDefault();
        if (event.shiftKey) {
            logout();
        } else {
            lock();
        }
        return true;
    }

    if (key === 'u') {
        event.preventDefault();
        if (event.shiftKey) {
            openUserQr?.();
        } else {
            openUserMenu?.();
        }
        return true;
    }

    if (key === 's') {
        event.preventDefault();
        openDialog('payments', { tab: 'send' });
        return true;
    }

    if (key === 'd') {
        event.preventDefault();
        openDialog('payments', { tab: 'request' });
        return true;
    }

    if (key === 'h') {
        event.preventDefault();
        cloak();
        return true;
    }

    return false;
}
