'use client';

import { cleanCameraFacing, cleanResumeRoute } from './schema.js';

export function readLastCameraFacing(cache) {
    return cleanCameraFacing(cache?.read?.()?.lastCameraFacing) || 'back';
}

export function writeLastCameraFacing(cache, facing) {
    const nextFacing = cleanCameraFacing(facing);
    if (!cache?.patch || !nextFacing) {
        return;
    }
    if (readLastCameraFacing(cache) === nextFacing) {
        return;
    }

    void cache.patch((payload) => {
        payload.lastCameraFacing = nextFacing;
        return payload;
    });
}

export function readResumeRoute(cache) {
    return cleanResumeRoute(cache?.read?.()?.resumeRoute);
}

export function readResumeTarget(cache) {
    const payload = cache?.read?.();
    const route = cleanResumeRoute(payload?.resumeRoute);
    if (!route) {
        return null;
    }

    return { route };
}

export function writeResumeRoute(cache, route) {
    const nextRoute = cleanResumeRoute(route);
    if (!cache?.patch || !nextRoute) {
        return;
    }
    const current = readResumeTarget(cache);
    if (current?.route === nextRoute) {
        return;
    }

    void cache.patch((payload) => {
        payload.resumeRoute = nextRoute;
        return payload;
    });
}

export function writeResumeTarget(cache, target) {
    const nextRoute = cleanResumeRoute(target?.route ?? target);
    if (!cache?.patch || !nextRoute) {
        return;
    }

    const current = readResumeTarget(cache);
    if (current?.route === nextRoute) {
        return;
    }

    void cache.patch((payload) => {
        payload.resumeRoute = nextRoute;
        return payload;
    });
}
