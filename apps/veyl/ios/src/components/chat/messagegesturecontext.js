import { createContext, useContext } from 'react';

const MessageGestureContext = createContext({
    blockLike: () => {},
    setSwipeBlocked: () => {},
});

export const MessageGestureProvider = MessageGestureContext.Provider;

export function useMessageGesture() {
    return useContext(MessageGestureContext);
}
