import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { create, get } from 'react-native-passkeys';

import { auth, functions } from '@/lib/firebase';
import { randomPasskeyLabel } from '@veyl/shared/passkeylabel';
import { getPasskeyOrigin } from '@veyl/shared/network';
import { isPasskeyRpMismatchError, isUnlinkedPasskeyError, normalizePasskeyLoginError, normalizePasskeyRegisterError } from '@veyl/shared/passkey';

export { isPasskeyRpMismatchError, isUnlinkedPasskeyError };

export async function passkeyRegister({ onPrompt, onVerified, label: providedLabel } = {}) {
    try {
        const label = providedLabel?.trim() || randomPasskeyLabel();
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
            attestation,
        });

        if (typeof onVerified === 'function') {
            await onVerified({ uid });
        }

        await signInWithCustomToken(auth, token);

        return { success: true };
    } catch (error) {
        throw normalizePasskeyRegisterError(error);
    }
}

export async function passkeyLogin({ uid, onPrompt } = {}) {
    try {
        const origin = getPasskeyOrigin();

        const {
            data: { opts },
        } = await httpsCallable(functions, 'passkeyLoginOptions')({ origin, uid });

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
        throw normalizePasskeyLoginError(error);
    }
}
