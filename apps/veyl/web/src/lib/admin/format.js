import { formatUserDisplay } from '@veyl/shared/profile';
import { timestampMs } from '@veyl/shared/utils/time';

const dateTime = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
});

export function displayUser(user) {
    return user?.username || user?.uid || (user ? formatUserDisplay(user) : 'unknown user');
}

export function botPowerClass(bot) {
    if (!bot?.enabled) return 'text-destructive';
    if (bot?.active) return 'text-active';
    return 'text-pending';
}

export function formatSats(balance) {
    const sats = Number(balance);
    return Number.isFinite(sats) ? `${sats.toLocaleString()} sats` : null;
}

export function formatDateTime(value, fallback = '') {
    const ms = timestampMs(value, null, { parseString: true });
    return ms == null ? fallback : dateTime.format(new Date(ms));
}
