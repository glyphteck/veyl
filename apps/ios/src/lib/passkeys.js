import { create, get } from 'react-native-passkeys';

import { cloud } from '@/lib/cloud';
import { randomPasskeyLabel } from '@veyl/shared/passkeylabel';
import { getPasskeyOrigin } from '@veyl/shared/network';
import { isPasskeyRpMismatchError, isUnlinkedPasskeyError, normalizePasskeyLoginError, normalizePasskeyRegisterError } from '@veyl/shared/passkey';

export { isPasskeyRpMismatchError, isUnlinkedPasskeyError };

export async function passkeyRegister({ onPrompt, onVerified, label: providedLabel } = {}) {
    try {
        const label = providedLabel?.trim() || randomPasskeyLabel();
        const origin = getPasskeyOrigin();

        const { uid, opts } = await cloud.auth.register.start({
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

        await cloud.auth.register.finish({
            attestation,
        });

        if (typeof onVerified === 'function') {
            await onVerified({ uid });
        }

        return { success: true };
    } catch (error) {
        throw normalizePasskeyRegisterError(error);
    }
}

export async function passkeyLogin({ uid, onPrompt } = {}) {
    try {
        const origin = getPasskeyOrigin();

        const { opts } = await cloud.auth.login.start({ origin, uid });

        if (typeof onPrompt === 'function') {
            onPrompt();
        }

        const assertion = await get(opts);
        if (!assertion) {
            throw new Error('no assertion received');
        }

        await cloud.auth.login.finish({
            assertion,
        });

        return { success: true };
    } catch (error) {
        throw normalizePasskeyLoginError(error);
    }
}
