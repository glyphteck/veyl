'use client';

import { readInviteOrQr } from '@veyl/shared/invite';

const PENDING_INVITE_KEY = 'veyl.pendingInvite';

function storage() {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}

export function readPendingInvite() {
    const store = storage();
    if (!store) return null;

    try {
        return readInviteOrQr(JSON.parse(store.getItem(PENDING_INVITE_KEY)));
    } catch {
        return null;
    }
}

export function writePendingInvite(value) {
    const invite = readInviteOrQr(value);
    const store = storage();
    if (!invite || !store) return null;

    try {
        store.setItem(PENDING_INVITE_KEY, JSON.stringify(invite));
        return invite;
    } catch {
        return null;
    }
}

export function writePendingInviteFromLocation() {
    if (typeof window === 'undefined') return null;
    const href = `${window.location.pathname}${window.location.search}`;
    return writePendingInvite(href);
}

export function dropPendingInvite() {
    try {
        storage()?.removeItem(PENDING_INVITE_KEY);
    } catch {}
}
