import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { truncateAddress, formatDate, formatHour, formatTimeHHMM, formatFullDateTime, formatDuration, formatBytes, formatUserDisplay, getEmojiTextInfo, satsInABitcoin, toSats, toDisplay, renderMoney, renderBalance, renderNet } from '@glyphteck/shared/utils';

export function cn(...inputs) {
    return twMerge(clsx(inputs));
}

export { truncateAddress, formatDate, formatHour, formatTimeHHMM, formatFullDateTime, formatDuration, formatBytes, formatUserDisplay, getEmojiTextInfo, satsInABitcoin, toSats, toDisplay, renderMoney, renderBalance, renderNet };
