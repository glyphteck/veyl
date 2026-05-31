'use client';

import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, getFunctions } from '@/lib/firebase/firebaseclient';
import { randomPasskeyLabel } from '@veyl/shared/passkeylabel';
import { isPasskeyEnvironmentMismatchError, isPasskeyRpMismatchError, isUnlinkedPasskeyError, normalizePasskeyLoginError, normalizePasskeyRegisterError } from '@veyl/shared/passkey';

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

export { isPasskeyEnvironmentMismatchError, isPasskeyRpMismatchError, isUnlinkedPasskeyError };

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

        return { success: true };
    } catch (error) {
        throw normalizePasskeyLoginError(error, { localhostSilo: true });
    }
}

export async function passkeyRegister({ label: providedLabel } = {}) {
    try {
        const label = providedLabel?.trim() || randomPasskeyLabel();
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

        return { success: true };
    } catch (error) {
        throw normalizePasskeyRegisterError(error, { invalidArgument: true });
    }
}
