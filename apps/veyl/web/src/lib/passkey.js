'use client';

import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, getFunctions } from '@/lib/firebase/firebaseclient';
import { generateLabel } from '@glyphteck/shared/labelgenerator';

function normalizeLoginError(error) {
    if (error?.code === 'functions/failed-precondition' && error?.message?.includes('Localhost uses a separate passkey silo')) {
        const next = new Error('This passkey belongs to glyphteck.com, not localhost.');
        next.code = 'passkey-environment-mismatch';
        next.cause = error;
        return next;
    }
    if (error?.code === 'functions/not-found') {
        const next = new Error('This passkey is no longer linked to an account.');
        next.code = 'passkey-unlinked';
        next.cause = error;
        return next;
    }
    if (error?.code === 'functions/failed-precondition') {
        const next = new Error('This passkey belongs to a different Glyphteck passkey setup.');
        next.code = 'passkey-rp-mismatch';
        next.cause = error;
        return next;
    }
    return error;
}

function normalizeRegisterError(error) {
    if (error?.code === 'functions/failed-precondition') {
        const next = new Error('This passkey belongs to a different Glyphteck passkey setup.');
        next.code = 'passkey-rp-mismatch';
        next.cause = error;
        return next;
    }
    if (error?.code === 'functions/invalid-argument' && error?.message) {
        const next = new Error(error.message);
        next.code = 'passkey-register-invalid';
        next.cause = error;
        return next;
    }
    return error;
}

// Passkey utility functions
export function abToB64(ab) {
    return btoa(String.fromCharCode(...new Uint8Array(ab)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export function b64ToAb(b64) {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}

export function credToJSON(cred) {
    return JSON.parse(JSON.stringify(cred, (_, v) => (v instanceof ArrayBuffer ? abToB64(v) : v)));
}

export function optsFromServer(o) {
    return {
        ...o,
        challenge: b64ToAb(o.challenge),
        user: o.user && { ...o.user, id: b64ToAb(o.user.id) },
        allowCredentials: (o.allowCredentials ?? []).map((c) => ({ ...c, id: b64ToAb(c.id) })),
        excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ ...c, id: b64ToAb(c.id) })),
    };
}

export function isUnlinkedPasskeyError(error) {
    return error?.code === 'passkey-unlinked';
}

export function isPasskeyRpMismatchError(error) {
    return error?.code === 'passkey-rp-mismatch';
}

export function isPasskeyEnvironmentMismatchError(error) {
    return error?.code === 'passkey-environment-mismatch';
}

// Passkey authentication functions
export async function passkeyLogin({ uid, onPrompt } = {}) {
    try {
        const origin = window.location.origin;
        const functions = getFunctions();
        const {
            data: { opts },
        } = await httpsCallable(functions, 'passkeyLoginOptions')({ origin, uid });

        if (typeof onPrompt === 'function') {
            onPrompt();
        }

        const assertion = await navigator.credentials.get({
            publicKey: optsFromServer(opts),
            mediation: 'required',
        });

        if (!assertion) {
            throw new Error('No assertion received');
        }

        const {
            data: { token },
        } = await httpsCallable(
            functions,
            'passkeyLoginVerify'
        )({
            assertion: credToJSON(assertion),
        });

        await signInWithCustomToken(auth, token);

        // Get ID token and create session cookie
        const idToken = await auth.currentUser.getIdToken();
        await fetch('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
        });

        return { success: true };
    } catch (error) {
        throw normalizeLoginError(error);
    }
}

export async function passkeyRegister({ label: providedLabel } = {}) {
    try {
        const label = providedLabel?.trim() || generateLabel();
        const origin = window.location.origin;
        const functions = getFunctions();

        const {
            data: { opts },
        } = await httpsCallable(functions, 'passkeyRegisterOptions')({ label, origin });

        const cred = await navigator.credentials.create({
            publicKey: optsFromServer(opts),
        });

        if (!cred) {
            throw new Error('No credential received');
        }

        const {
            data: { token },
        } = await httpsCallable(
            functions,
            'passkeyRegisterVerify'
        )({
            attestation: credToJSON(cred),
        });

        await signInWithCustomToken(auth, token);

        // Get ID token and create session cookie
        const idToken = await auth.currentUser.getIdToken();
        await fetch('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
        });

        return { success: true };
    } catch (error) {
        throw normalizeRegisterError(error);
    }
}
