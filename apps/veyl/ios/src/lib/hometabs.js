import { warmCamera } from '@/lib/camera/warming';

export const HOME_TAB_NAMES = ['chat', 'camera', 'wallet', 'settings'];
export const HOME_TAB_ROOT_PATHS = new Set(HOME_TAB_NAMES.map((name) => `/${name}`));

export function isHomeTabRootPath(pathname) {
    const path = typeof pathname === 'string' ? pathname.trim().split('?')[0].split('#')[0] : '';
    return HOME_TAB_ROOT_PATHS.has(path);
}

export function homeTabForLastAppRoute(route) {
    if (route === '/camera') return 'camera';
    if (route === '/wallet') return 'wallet';
    return 'chat';
}

export function targetForHomeTab(name) {
    if (name === 'camera') return { route: '/camera' };
    if (name === 'wallet') return { route: '/wallet' };
    if (name === 'chat') return { route: '/chat' };
    return null;
}

export function warmHomeTab(name) {
    if (name === 'camera') warmCamera();
}
