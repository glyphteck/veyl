import { AUTOLOCK_MAX_MINUTES, AUTOLOCK_MIN_MINUTES } from './config.js';

export const SEND_ON_SCAN_ENABLED = false;
export const PAYMENT_BEHAVIOR_SETTINGS_VISIBLE = false;

export const defaultSettings = {
    glass: true,
    moneyFormat: 'usd',
    ghostWallet: true,
    sendOnScan: false,
    confirmSend: false,
    faceID: null,
    autolock: {
        timer: 'never',
        onHide: false,
        onBlur: false,
        onBackground: false,
    },
};

export function canSendOnScan(settings) {
    return SEND_ON_SCAN_ENABLED && settings?.sendOnScan === true;
}

export function normalizeAutolock(autolock, base = defaultSettings.autolock) {
    if (autolock !== undefined && (!autolock || typeof autolock !== 'object' || Array.isArray(autolock))) {
        throw new Error('bad autolock');
    }

    const next = {
        ...defaultSettings.autolock,
        ...(base || {}),
        ...(autolock || {}),
    };

    if (next.timer !== 'never' && (!Number.isInteger(next.timer) || next.timer < AUTOLOCK_MIN_MINUTES || next.timer > AUTOLOCK_MAX_MINUTES)) {
        throw new Error('bad timer');
    }
    if (typeof next.onHide !== 'boolean') {
        throw new Error('bad onHide');
    }
    if (typeof next.onBlur !== 'boolean') {
        throw new Error('bad onBlur');
    }
    if (typeof next.onBackground !== 'boolean') {
        throw new Error('bad onBackground');
    }

    return next;
}

export function normalizeSettings(settings, base = defaultSettings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new Error('settings object required');
    }

    const current = {
        ...defaultSettings,
        ...(base || {}),
        autolock: {
            ...defaultSettings.autolock,
            ...(base?.autolock || {}),
        },
    };

    const next = {
        ...current,
        ...settings,
        ghostWallet: defaultSettings.ghostWallet,
    };

    next.autolock = normalizeAutolock(settings.autolock, current.autolock);

    if (!['btc', 'usd', 'sats'].includes(next.moneyFormat)) {
        throw new Error('bad moneyFormat');
    }
    if (typeof next.glass !== 'boolean') {
        throw new Error('glass must be boolean');
    }
    if (typeof next.ghostWallet !== 'boolean') {
        throw new Error('ghostWallet must be boolean');
    }
    if (typeof next.sendOnScan !== 'boolean') {
        throw new Error('sendOnScan must be boolean');
    }
    if (!SEND_ON_SCAN_ENABLED) {
        next.sendOnScan = false;
    }
    if (typeof next.confirmSend !== 'boolean') {
        throw new Error('confirmSend must be boolean');
    }
    if (next.faceID !== null && typeof next.faceID !== 'boolean') {
        throw new Error('faceID must be boolean or null');
    }

    return next;
}
