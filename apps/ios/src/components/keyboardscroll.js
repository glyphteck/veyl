import { forwardRef } from 'react';
import * as KeyboardController from 'react-native-keyboard-controller';
import { useStableSafeAreaInsets } from '@/lib/safearea';

const BOTTOM_GAP = 8;
const ControllerKeyboardChatScrollView = KeyboardController.KeyboardChatScrollView;
const KeyboardProvider = KeyboardController.KeyboardProvider;

export const useKeyboardHandler = KeyboardController.useKeyboardHandler;
export const KeyboardStickyView = KeyboardController.KeyboardStickyView;
export const useReanimatedKeyboardAnimation = KeyboardController.useReanimatedKeyboardAnimation;

export function getKeyboardOffset(bottom) {
    return Math.max(0, Math.round((Number.isFinite(bottom) ? bottom : 0) - BOTTOM_GAP));
}

export function KeyboardRootProvider({ children }) {
    return <KeyboardProvider>{children}</KeyboardProvider>;
}

export const KeyboardChatScrollView = forwardRef(function KeyboardChatScrollView({ keyboardDismissMode = 'interactive', keyboardLiftBehavior = 'always', bottomOffset, extraContentPadding, ...props }, ref) {
    const insets = useStableSafeAreaInsets();
    const offset = Number.isFinite(bottomOffset) ? bottomOffset : getKeyboardOffset(insets.bottom);

    return (
        <ControllerKeyboardChatScrollView
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
