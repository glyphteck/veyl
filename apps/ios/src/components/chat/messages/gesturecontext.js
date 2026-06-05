import { createContext, useContext, useMemo } from 'react';

const GestureContext = createContext({
    likeGesture: null,
    replyGesture: null,
    timeGesture: null,
});

export const GestureProvider = GestureContext.Provider;

export function useGesture() {
    return useContext(GestureContext);
}

export function useGestureBlockers({ includeLike = false } = {}) {
    const { likeGesture, replyGesture, timeGesture } = useGesture();
    return useMemo(() => [includeLike ? likeGesture : null, replyGesture, timeGesture].filter(Boolean), [includeLike, likeGesture, replyGesture, timeGesture]);
}
