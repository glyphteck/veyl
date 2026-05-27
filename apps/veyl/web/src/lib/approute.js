'use client';

export const DEFAULT_APP_HREF = '/chat';

function cleanChatPeer(peer) {
    const value = typeof peer === 'string' ? peer.trim().toLowerCase() : '';
    return /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function lastAppTargetForPathname(pathname, chatPeer) {
    const path = typeof pathname === 'string' ? pathname.split('?')[0].split('#')[0] : '';
    const parts = path.split('/').filter(Boolean);
    const root = parts[0] ? `/${parts[0]}` : '';

    if (root === '/camera') return { route: '/camera' };
    if (root === '/wallet') return { route: '/wallet' };
    if (root === '/chat') return { route: '/chat', chatPeer: cleanChatPeer(chatPeer) };
    return null;
}

export function hrefForLastAppTarget(target) {
    if (target?.route === '/camera') return '/camera';
    if (target?.route === '/wallet') return '/wallet';
    return DEFAULT_APP_HREF;
}
