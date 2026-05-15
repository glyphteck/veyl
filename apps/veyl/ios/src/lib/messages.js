import { alpha } from '@/lib/colors';

export function bubbleTint(theme, fromPeer = false) {
    return fromPeer ? alpha(theme.foreground, 10) : alpha(theme.foreground, 5);
}

export function imageWidth(aspect) {
    return Math.round(Math.max(160, Math.min(260, aspect * 220)));
}
