import { Screen } from 'react-native-screens';

export const TOP_SCROLL_EDGE_EFFECTS = {
    top: 'soft',
    bottom: 'hidden',
    left: 'hidden',
    right: 'hidden',
};

export const INVERTED_TOP_SCROLL_EDGE_EFFECTS = {
    top: 'soft',
    bottom: 'hidden',
    left: 'hidden',
    right: 'hidden',
};

export function ScrollEdgeScreen({ children, scrollEdgeEffects = TOP_SCROLL_EDGE_EFFECTS, style, ...props }) {
    return (
        <Screen activityState={2} style={[{ flex: 1 }, style]} scrollEdgeEffects={scrollEdgeEffects} {...props}>
            {children}
        </Screen>
    );
}
