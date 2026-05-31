export const DEFAULT_RESUME_HREF = '/chat';

export function resumeTargetFromPath(pathname) {
    const path = typeof pathname === 'string' ? pathname.trim().split('?')[0].split('#')[0] : '';
    const parts = path.split('/').filter(Boolean);
    const root = parts[0] ? `/${parts[0]}` : '';

    if (root === '/camera') return { route: '/camera' };
    if (root === '/wallet') return { route: '/wallet' };
    if (root === '/chat') return { route: '/chat' };
    return null;
}

export function hrefForResumeTarget(target) {
    const route = target?.route || target;
    if (route === '/camera') return '/camera';
    if (route === '/wallet') return '/wallet';
    return DEFAULT_RESUME_HREF;
}
