import { deleteField, doc, getDoc, setDoc } from 'firebase/firestore';

export const defaultSettings = {
    glass: true,
    moneyFormat: 'usd',
    ghostWallet: false,
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

export function normalizeAutolock(autolock, base = defaultSettings.autolock) {
    if (autolock !== undefined && (!autolock || typeof autolock !== 'object' || Array.isArray(autolock))) {
        throw new Error('bad autolock');
    }

    const next = {
        ...defaultSettings.autolock,
        ...(base || {}),
        ...(autolock || {}),
    };

    if (next.timer !== 'never' && (!Number.isInteger(next.timer) || next.timer < 1 || next.timer > 60)) {
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
    if (typeof next.confirmSend !== 'boolean') {
        throw new Error('confirmSend must be boolean');
    }
    if (next.faceID !== null && typeof next.faceID !== 'boolean') {
        throw new Error('faceID must be boolean or null');
    }

    return next;
}

export async function writeUserSettings({ db, uid, settings, currentSettings }) {
    if (!db) throw new Error('db');
    if (!uid) throw new Error('uid');

    let base = currentSettings;

    try {
        const snap = await getDoc(doc(db, 'users', uid));
        const saved = snap.exists() ? snap.data()?.settings : null;
        const { autolock: rawAutolock, ...rawSettings } = saved || {};
        base = {
            ...defaultSettings,
            ...rawSettings,
            autolock: {
                ...defaultSettings.autolock,
                ...(rawAutolock || {}),
            },
        };
    } catch (error) {
        if (!base) {
            throw error;
        }
    }

    const nextSettings = normalizeSettings(settings, base);

    await setDoc(
        doc(db, 'users', uid),
        {
            settings: nextSettings,
            walletNotifications: deleteField(),
        },
        { merge: true }
    );

    return nextSettings;
}
