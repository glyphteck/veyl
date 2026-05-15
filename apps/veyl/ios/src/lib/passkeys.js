import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { create, get } from 'react-native-passkeys';

import { auth, functions } from '@/lib/firebase';
import { generateLabel } from '@glyphteck/shared/labelgenerator';
import { getPasskeyOrigin } from '@glyphteck/shared/network';

function normalizeLoginError(error) {
    if (error?.code === 'functions/not-found') {
        const next = new Error('This passkey is no longer linked to an account.');
        next.code = 'passkey-unlinked';
        next.cause = error;
        return next;
    }
    if (error?.code === 'functions/failed-precondition') {
        const next = new Error('This passkey belongs to an older Gliftec passkey setup.');
        next.code = 'passkey-rp-mismatch';
        next.cause = error;
        return next;
    }
    return error;
}

function normalizeRegisterError(error) {
    if (error?.code === 'functions/failed-precondition') {
        const next = new Error('This passkey belongs to a different Gliftec passkey setup.');
        next.code = 'passkey-rp-mismatch';
        next.cause = error;
        return next;
    }
    return error;
}

export function isUnlinkedPasskeyError(error) {
    return error?.code === 'passkey-unlinked';
}

export function isPasskeyRpMismatchError(error) {
    return error?.code === 'passkey-rp-mismatch';
}

export async function passkeyRegister({ onPrompt, label: providedLabel } = {}) {
    try {
        const label = providedLabel?.trim() || generateLabel();
        const origin = getPasskeyOrigin();

        const {
            data: { uid, opts },
        } = await httpsCallable(
            functions,
            'passkeyRegisterOptions'
        )({
            label,
            origin,
        });

        if (typeof onPrompt === 'function') {
            onPrompt();
        }

        const attestation = await create(opts);
        if (!attestation) {
            throw new Error('no credential created');
        }

        const {
            data: { token },
        } = await httpsCallable(
            functions,
            'passkeyRegisterVerify'
        )({
            uid,
            attestation,
        });

        await signInWithCustomToken(auth, token);

        return { success: true };
    } catch (error) {
        throw normalizeRegisterError(error);
    }
}

export async function passkeyLogin({ onPrompt } = {}) {
    try {
        const origin = getPasskeyOrigin();

        const {
            data: { opts },
        } = await httpsCallable(functions, 'passkeyLoginOptions')({ origin });

        if (typeof onPrompt === 'function') {
            onPrompt();
        }

        const assertion = await get(opts);
        if (!assertion) {
            throw new Error('no assertion received');
        }

        const {
            data: { token },
        } = await httpsCallable(
            functions,
            'passkeyLoginVerify'
        )({
            assertion,
        });

        await signInWithCustomToken(auth, token);

        return { success: true };
    } catch (error) {
        throw normalizeLoginError(error);
    }
}
