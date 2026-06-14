import { View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';

import GlassIcon from '@/components/glass/glassicon';
import { useStableSafeAreaInsets } from '@/lib/safearea';

export const FLOATING_HEADER_SIDE = 56;
export const FLOATING_HEADER_BOTTOM_PAD = 8;
export const FLOATING_HEADER_SCROLL_EDGE_PAD = 12;
export const FLOATING_HEADER_ICON_SIZE = 48;
export const FLOATING_HEADER_ICON_CONTENT_SIZE = 32;
export const FLOATING_HEADER_BACK_ICON_STROKE_WIDTH = 3.2;
export const FLOATING_HEADER_BACK_ICON_STYLE = { transform: [{ translateX: -1 }] };

export function getFloatingHeaderHeight(topInset = 0) {
    return topInset + FLOATING_HEADER_SIDE + FLOATING_HEADER_BOTTOM_PAD;
}

export function getFloatingHeaderScrollEdgeInset(topInset = 0) {
    return getFloatingHeaderHeight(topInset);
}

export function FloatingHeaderBackIcon(props) {
    return (
        <GlassIcon
            icon={ChevronLeft}
            size={FLOATING_HEADER_ICON_SIZE}
            iconSize={FLOATING_HEADER_ICON_CONTENT_SIZE}
            iconStrokeWidth={FLOATING_HEADER_BACK_ICON_STROKE_WIDTH}
            iconStyle={FLOATING_HEADER_BACK_ICON_STYLE}
            {...props}
        />
    );
}

export default function FloatingHeader({ onLayout, pointerEvents = 'box-none', style, contentStyle, children }) {
    const insets = useStableSafeAreaInsets();

    return (
        <View
            onLayout={onLayout}
            pointerEvents={pointerEvents}
            style={[
                {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 2,
                    paddingTop: insets.top,
                    paddingBottom: FLOATING_HEADER_BOTTOM_PAD,
                    paddingHorizontal: 12,
                },
                style,
            ]}
        >
            {children ? <View style={[{ minHeight: FLOATING_HEADER_SIDE, flexDirection: 'row', alignItems: 'center', zIndex: 1 }, contentStyle]}>{children}</View> : null}
        </View>
    );
}
