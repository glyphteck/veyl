import { createContext, useContext, useMemo } from 'react';

const MessageGestureContext = createContext({
    likeGesture: null,
    replyGesture: null,
    timeGesture: null,
});

export const MessageGestureProvider = MessageGestureContext.Provider;

export function useMessageGesture() {
    return useContext(MessageGestureContext);
}

export function useMessageGestureBlockers({ includeLike = false } = {}) {
    const { likeGesture, replyGesture, timeGesture } = useMessageGesture();
    return useMemo(() => [includeLike ? likeGesture : null, replyGesture, timeGesture].filter(Boolean), [includeLike, likeGesture, replyGesture, timeGesture]);
}
