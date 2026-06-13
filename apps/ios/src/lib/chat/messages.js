import { alpha } from '@/lib/colors';

const PEER_BUBBLE_TINT_OPACITY = 5;
const USER_BUBBLE_TINT_OPACITY = 3;
const BUBBLE_SHADOW_OPACITY = 0.1;
const BUBBLE_SHADOW_RADIUS = 3;

export function bubbleTint(theme, fromPeer = false) {
    return alpha(theme.foreground, fromPeer ? PEER_BUBBLE_TINT_OPACITY : USER_BUBBLE_TINT_OPACITY);
}

export function bubbleShadow(theme) {
    return {
        shadowColor: theme.shadow,
        shadowOpacity: BUBBLE_SHADOW_OPACITY,
        shadowRadius: BUBBLE_SHADOW_RADIUS,
        shadowOffset: { width: 0, height: 0 },
    };
}

export function bubbleStyle(theme, fromPeer = false) {
    return {
        backgroundColor: bubbleTint(theme, fromPeer),
        ...bubbleShadow(theme),
    };
}

export function imageWidth(aspect) {
    return Math.round(Math.max(160, Math.min(260, aspect * 220)));
}
