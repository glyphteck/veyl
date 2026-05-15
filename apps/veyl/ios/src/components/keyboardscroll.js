import { forwardRef } from 'react';
import * as KeyboardController from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BOTTOM_GAP = 8;
const KeyboardChatScrollView = KeyboardController.KeyboardChatScrollView;
const KeyboardProvider = KeyboardController.KeyboardProvider;

export const KeyboardGestureArea = KeyboardController.KeyboardGestureArea;
export const KeyboardStickyView = KeyboardController.KeyboardStickyView;
export const useReanimatedKeyboardAnimation = KeyboardController.useReanimatedKeyboardAnimation;

export function getKeyboardOffset(bottom) {
    return Math.max(0, Math.round((Number.isFinite(bottom) ? bottom : 0) - BOTTOM_GAP));
}

export function KeyboardRootProvider({ children }) {
    return <KeyboardProvider>{children}</KeyboardProvider>;
}

export const KeyboardListScrollView = forwardRef(function KeyboardListScrollView({ keyboardDismissMode = 'interactive', keyboardLiftBehavior = 'always', bottomOffset, extraContentPadding, ...props }, ref) {
    const insets = useSafeAreaInsets();
    const offset = Number.isFinite(bottomOffset) ? bottomOffset : getKeyboardOffset(insets.bottom);

    return (
        <KeyboardChatScrollView
            ref={ref}
            {...props}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode={keyboardDismissMode}
            keyboardLiftBehavior={keyboardLiftBehavior}
            offset={offset}
            extraContentPadding={extraContentPadding}
        />
    );
});
