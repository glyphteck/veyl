export const DEFAULT_APP_HREF = '/chat';

function cleanChatPeer(peer) {
    const value = typeof peer === 'string' ? peer.trim().toLowerCase() : '';
    return /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function hrefForLastAppRoute(route) {
    if (route === '/camera') return '/camera';
    if (route === '/wallet') return '/wallet';
    return DEFAULT_APP_HREF;
}

export function tabForLastAppRoute(route) {
    if (route === '/camera') return 'camera';
    if (route === '/wallet') return 'wallet';
    return 'chat';
}

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

export function lastAppTargetForNavigationState(state) {
    const { route, names, params } = focusedRoutePathForNavigationState(state);
    const name = typeof route?.name === 'string' ? route.name : null;
    const chatPeer = cleanChatPeer(params?.peerchatpk);
    if (chatPeer) return { route: '/chat', chatPeer };
    if (name === 'chat') return { route: '/chat' };
    if (names.includes('chat/[peerchatpk]') || names.includes('chat/[peerchatpk]/index') || names.includes('chat/[peerchatpk]/settings')) {
        return { route: '/chat', chatPeer: null };
    }
    if (name === 'camera') return { route: '/camera' };
    if (name === 'wallet') return { route: '/wallet' };
    return null;
}

export function hrefForLastAppTarget(target) {
    const route = target?.route || target;
    const chatPeer = typeof target?.chatPeer === 'string' ? target.chatPeer.trim().toLowerCase() : '';
    if (route === '/camera') return '/camera';
    if (route === '/wallet') return '/wallet';
    if (route === '/chat' && cleanChatPeer(chatPeer)) {
        return { pathname: '/chat/[peerchatpk]', params: { peerchatpk: chatPeer } };
    }
    return DEFAULT_APP_HREF;
}
