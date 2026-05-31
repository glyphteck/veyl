import { useCallback, useEffect, useRef } from 'react';
import { nonNegativeNumber } from '@veyl/shared/utils/number';

export function useRouteLock(defaultMs = 1200) {
    const routeLockedRef = useRef(false);
    const timerRef = useRef(null);

    const clearRouteLock = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }
        timerRef.current = null;
        routeLockedRef.current = false;
    }, []);

    const lockRoute = useCallback(
        (ms = defaultMs) => {
            if (routeLockedRef.current) {
                return false;
            }
            routeLockedRef.current = true;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
            timerRef.current = setTimeout(clearRouteLock, nonNegativeNumber(ms, 0));
            return true;
        },
        [clearRouteLock, defaultMs]
    );

    useEffect(() => clearRouteLock, [clearRouteLock]);

    return { clearRouteLock, lockRoute, routeLockedRef };
}
