const FULL_SCREEN_GESTURE_DISTANCE = 10000;

const FULL_SCREEN_BACK_OPTIONS = {
    gestureEnabled: true,
    fullScreenGestureEnabled: true,
    gestureResponseDistance: {
        start: 0,
        end: FULL_SCREEN_GESTURE_DISTANCE,
        top: 0,
        bottom: FULL_SCREEN_GESTURE_DISTANCE,
    },
};

export function stackScreenOptions(theme, sheetRoutes = null) {
    return ({ route }) => ({
        headerShown: false,
        ...(sheetRoutes?.has(route?.name) ? {} : FULL_SCREEN_BACK_OPTIONS),
        contentStyle: { backgroundColor: theme?.background },
    });
}
