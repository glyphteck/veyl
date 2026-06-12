export function bubbleTint(theme, fromPeer = false) {
    return fromPeer ? theme.glassBackgroundSoft : theme.glassBackground;
}

export function imageWidth(aspect) {
    return Math.round(Math.max(160, Math.min(260, aspect * 220)));
}
