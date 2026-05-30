export const DEFAULT_APP_HREF = '/chat';

function focusedRoutePathForNavigationState(state) {
    let current = state;
    let route = null;
    const names = [];
    const params = {};

    while (current?.routes?.length) {
        const index = Number.isInteger(current.index) ? current.index : 0;
        route = current.routes[index] || current.routes[0] || null;
        if (typeof route?.name === 'string') names.push(route.name);
        if (route?.params && typeof route.params === 'object') Object.assign(params, route.params);
        current = route?.state;
    }

    return { route, names, params };
}

export function routeNameForNavigationState(state) {
    const { route } = focusedRoutePathForNavigationState(state);
    return typeof route?.name === 'string' ? route.name : null;
}

export function lastAppRouteForNavigationState(state) {
    return lastAppTargetForNavigationState(state)?.route ?? null;
}

export function lastAppTargetForPathname(pathname) {
    const path = typeof pathname === 'string' ? pathname.trim().split('?')[0].split('#')[0] : '';
    const parts = path.split('/').filter(Boolean);
    const root = parts[0] ? `/${parts[0]}` : '';

    if (root === '/camera') return { route: '/camera' };
    if (root === '/wallet') return { route: '/wallet' };
    if (root === '/chat') return { route: '/chat' };
    return null;
}

export function lastAppTargetForNavigationState(state) {
    const { route, names, params } = focusedRoutePathForNavigationState(state);
    const name = typeof route?.name === 'string' ? route.name : null;
    if (params?.peerchatpk) return { route: '/chat' };
    if (name === 'chat') return { route: '/chat' };
    if (names.includes('chat/[peerchatpk]') || names.includes('chat/[peerchatpk]/index') || names.includes('chat/[peerchatpk]/settings')) {
        return { route: '/chat' };
    }
    if (name === 'camera') return { route: '/camera' };
    if (name === 'wallet') return { route: '/wallet' };
    return null;
}

export function hrefForLastAppTarget(target) {
    const route = target?.route || target;
    if (route === '/camera') return '/camera';
    if (route === '/wallet') return '/wallet';
    return DEFAULT_APP_HREF;
}
