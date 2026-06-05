import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { messageKeys } from '@veyl/shared/chat/messagekeys';
import { getMessageKey } from '@veyl/shared/chat/state';
import { sameArray } from '@veyl/shared/utils/array';
import { MESSAGE_ROW_LEAVE_MS, afterNextPaint } from '../rowmotion';

export const EMPTY_KEY_SET = new Set();

function rowHasKey(row, keys) {
    if (!keys?.size) {
        return false;
    }
    if (row?.key && keys.has(row.key)) {
        return true;
    }
    return messageKeys(row?.msg).some((key) => keys.has(key));
}

function makePresentRows(messages, hiddenKeys = EMPTY_KEY_SET) {
    return messages
        .map((msg) => ({
            key: getMessageKey(msg),
            msg,
            state: 'present',
        }))
        .filter((row) => row.key && !rowHasKey(row, hiddenKeys));
}

export function useAnimatedRows(messages, scopeKey, hiddenKeys = EMPTY_KEY_SET, animate = true) {
    const presentRows = useMemo(() => makePresentRows(messages, hiddenKeys), [hiddenKeys, messages]);
    const [state, setState] = useState(() => ({ scopeKey, rows: presentRows, animated: animate }));
    const reset = state.scopeKey !== scopeKey;

    useLayoutEffect(() => {
        setState((prev) => {
            if (prev.scopeKey !== scopeKey || !animate || !prev.animated) {
                return { scopeKey, rows: presentRows, animated: animate };
            }

            const nextKeys = new Set(presentRows.map((row) => row.key));
            const prevByKey = new Map();
            const prevIndexByKey = new Map();

            prev.rows.forEach((row, index) => {
                prevByKey.set(row.key, row);
                prevIndexByKey.set(row.key, index);
            });

            const firstRetainedIndex = presentRows.findIndex((row) => {
                const prevRow = prevByKey.get(row.key);
                return prevRow && prevRow.state !== 'leaving';
            });
            const newestInsertCount = prev.rows.length ? Math.max(0, firstRetainedIndex) : presentRows.length;

            const nextRows = presentRows.map((row, index) => {
                const prevRow = prevByKey.get(row.key);
                const retained = prevRow && prevRow.state !== 'leaving';
                const state = retained ? 'present' : index < newestInsertCount ? 'entering' : 'instant';
                if (prevRow && prevRow.state === state && prevRow.msg === row.msg) {
                    return prevRow;
                }
                return { ...row, state };
            });
            const olderInsertStart = nextRows.findIndex((row, index) => index >= newestInsertCount && row.state === 'instant');
            if (olderInsertStart > 0) {
                const boundary = nextRows[olderInsertStart - 1];
                if (boundary?.state === 'present') {
                    nextRows[olderInsertStart - 1] = { ...boundary, state: 'instant' };
                }
            }
            const result = [];
            let prevCursor = 0;

            const pushDroppedRowsBefore = (index) => {
                while (prevCursor < index) {
                    const row = prev.rows[prevCursor];
                    if (!nextKeys.has(row.key)) {
                        result.push(row.state === 'leaving' ? row : { ...row, state: 'leaving' });
                    }
                    prevCursor += 1;
                }
            };

            for (const row of nextRows) {
                const prevIndex = prevIndexByKey.get(row.key);
                if (prevIndex != null) {
                    pushDroppedRowsBefore(prevIndex);
                    prevCursor = Math.max(prevCursor, prevIndex + 1);
                }
                result.push(row);
            }

            pushDroppedRowsBefore(prev.rows.length);
            if (sameArray(prev.rows, result)) {
                return prev;
            }
            return { scopeKey, rows: result, animated: true };
        });
    }, [animate, presentRows, scopeKey]);

    useEffect(() => {
        if (!state.animated || state.scopeKey !== scopeKey || !state.rows.some((row) => row.state === 'entering' || row.state === 'instant')) {
            return undefined;
        }

        return afterNextPaint(() => {
            setState((prev) => {
                if (prev.scopeKey !== scopeKey) {
                    return prev;
                }
                return {
                    ...prev,
                    rows: prev.rows.map((row) => (row.state === 'entering' || row.state === 'instant' ? { ...row, state: 'present' } : row)),
                };
            });
        });
    }, [scopeKey, state.animated, state.rows, state.scopeKey]);

    useEffect(() => {
        if (!state.animated || state.scopeKey !== scopeKey || !state.rows.some((row) => row.state === 'leaving')) {
            return undefined;
        }

        const timeout = setTimeout(() => {
            setState((prev) => {
                if (prev.scopeKey !== scopeKey) {
                    return prev;
                }
                return {
                    ...prev,
                    rows: prev.rows.filter((row) => row.state !== 'leaving'),
                };
            });
        }, MESSAGE_ROW_LEAVE_MS + 50);

        return () => clearTimeout(timeout);
    }, [scopeKey, state.animated, state.rows, state.scopeKey]);

    return reset ? presentRows : state.rows;
}
