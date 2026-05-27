'use client';

export const DEFAULT_APP_HREF = '/chat';

export function lastAppTargetForPathname(pathname) {
    const path = typeof pathname === 'string' ? pathname.split('?')[0].split('#')[0] : '';
    const parts = path.split('/').filter(Boolean);
    const root = parts[0] ? `/${parts[0]}` : '';

    if (root === '/camera') return { route: '/camera' };
    if (root === '/wallet') return { route: '/wallet' };
    if (root === '/chat') return { route: '/chat' };
    return null;
}

export function hrefForLastAppTarget(target) {
    if (target?.route === '/camera') return '/camera';
    if (target?.route === '/wallet') return '/wallet';
    return DEFAULT_APP_HREF;
}
