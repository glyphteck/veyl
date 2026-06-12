'use client';

import { useEffect, useMemo, useState } from 'react';
import { nextRowDateTimeRefreshMs, timestampMs } from './time.js';

function normalizeTimes(values) {
    const list = Array.isArray(values) ? values : [values];
    return list.map((value) => timestampMs(value, null, { parseString: true })).filter(Number.isFinite);
}

export function useRowDateTimeNow(values) {
    const [now, setNow] = useState(() => Date.now());
    const times = useMemo(() => normalizeTimes(values), [values]);

    useEffect(() => {
        const next = Math.min(
            ...times
                .map((value) => nextRowDateTimeRefreshMs(value, now))
                .filter((value) => Number.isFinite(value) && value > now)
        );
        if (!Number.isFinite(next)) {
            return undefined;
        }

        const delay = Math.max(250, Math.min(next - Date.now() + 25, 2_147_483_647));
        const timeout = setTimeout(() => setNow(Date.now()), delay);
        return () => clearTimeout(timeout);
    }, [now, times]);

    return now;
}
