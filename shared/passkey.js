import { cleanText } from './utils/text.js';

export const PASSKEY_ENVIRONMENT_MISMATCH = 'passkey-environment-mismatch';
export const PASSKEY_REGISTER_INVALID = 'passkey-register-invalid';
export const PASSKEY_RP_MISMATCH = 'passkey-rp-mismatch';
export const PASSKEY_UNLINKED = 'passkey-unlinked';

function passkeyError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    error.cause = cause;
    return error;
}

export function normalizePasskeyLoginError(error, options = {}) {
    if (options.localhostSilo === true && error?.code === 'functions/failed-precondition' && cleanText(error?.message).includes('Localhost uses a separate passkey silo')) {
        return passkeyError(PASSKEY_ENVIRONMENT_MISMATCH, 'This passkey belongs to glyphteck.com, not localhost.', error);
    }
    if (error?.code === 'functions/not-found') {
        return passkeyError(PASSKEY_UNLINKED, 'This passkey is no longer linked to an account.', error);
    }
    if (error?.code === 'functions/failed-precondition') {
        return passkeyError(PASSKEY_RP_MISMATCH, 'This passkey belongs to a different Glyphteck passkey setup.', error);
    }
    return error;
}

export function normalizePasskeyRegisterError(error, options = {}) {
    if (error?.code === 'functions/failed-precondition') {
        return passkeyError(PASSKEY_RP_MISMATCH, 'This passkey belongs to a different Glyphteck passkey setup.', error);
    }
    if (options.invalidArgument === true && error?.code === 'functions/invalid-argument' && error?.message) {
        return passkeyError(PASSKEY_REGISTER_INVALID, error.message, error);
    }
    return error;
}

export function isUnlinkedPasskeyError(error) {
    return error?.code === PASSKEY_UNLINKED;
}

export function isPasskeyRpMismatchError(error) {
    return error?.code === PASSKEY_RP_MISMATCH;
}

export function isPasskeyEnvironmentMismatchError(error) {
    return error?.code === PASSKEY_ENVIRONMENT_MISMATCH;
}
