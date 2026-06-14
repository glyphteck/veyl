import { useEffect, useMemo, useState } from 'react';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

function positive(value) {
    const px = Math.round(Number(value) || 0);
    return px > 0 ? px : 0;
}

function initialInsets() {
    const insets = initialWindowMetrics?.insets || {};
    return {
        top: positive(insets.top),
        right: positive(insets.right),
        bottom: positive(insets.bottom),
        left: positive(insets.left),
    };
}

function mergeInsets(base, live) {
    const stable = base || initialInsets();
    const merged = {};
    for (const edge of ['top', 'right', 'bottom', 'left']) {
        const next = positive(live?.[edge]);
        merged[edge] = next > 0 ? next : positive(stable[edge]);
    }
    return merged;
}

function sameInsets(a, b) {
    return a?.top === b?.top && a?.right === b?.right && a?.bottom === b?.bottom && a?.left === b?.left;
}

export function useStableSafeAreaInsets() {
    const live = useSafeAreaInsets();
    const [stable, setStable] = useState(initialInsets);
    const resolved = useMemo(() => mergeInsets(stable, live), [live?.bottom, live?.left, live?.right, live?.top, stable]);

    useEffect(() => {
        setStable((prev) => {
            const next = mergeInsets(prev, live);
            return sameInsets(prev, next) ? prev : next;
        });
    }, [live?.bottom, live?.left, live?.right, live?.top]);

    return resolved;
}
