import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { MESSAGE_ROW_ENTER_STATE_MS, MESSAGE_ROW_LEAVE_MS } from '@/components/chat/rowmotion';
import { getMessageKey } from '@veyl/shared/chat/state';

function sameRowList(a, b) {
    if (a === b) {
        return true;
    }
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        if (
            a[index]?.key !== b[index]?.key ||
            a[index]?.msg !== b[index]?.msg ||
            a[index]?.state !== b[index]?.state ||
            a[index]?.enteredAt !== b[index]?.enteredAt ||
            a[index]?.dotExitToken !== b[index]?.dotExitToken
        ) {
            return false;
        }
    }
    return true;
}

function makePresentRows(messages) {
    return (messages || [])
        .map((msg) => ({
            key: getMessageKey(msg),
            msg,
            state: 'present',
            enteredAt: 0,
            dotExitToken: 0,
        }))
        .filter((row) => row.key);
}

function shouldExitPendingDot(previous, next) {
    return !!((previous?.pending || previous?.failed) && next && !next.pending && !next.failed);
}

export function useAnimatedRows(messages, scopeKey, animate = true) {
    const presentRows = useMemo(() => makePresentRows(messages), [messages]);
    const [state, setState] = useState(() => ({ scopeKey, rows: presentRows, animated: animate }));
    const reset = state.scopeKey !== scopeKey;

    useLayoutEffect(() => {
        setState((prev) => {
            if (prev.scopeKey !== scopeKey || !animate || !prev.animated) {
                return { scopeKey, rows: presentRows, animated: animate };
            }

            const now = Date.now();
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
                const confirmed = retained && shouldExitPendingDot(prevRow.msg, row.msg);
                const prevEnteredAt = prevRow?.enteredAt || now;
                const keepEntering = prevRow?.state === 'entering' && now - prevEnteredAt < MESSAGE_ROW_ENTER_STATE_MS;
                const retainedState = keepEntering || prevRow?.state === 'instant' ? prevRow.state : 'present';
                const nextState = retained ? retainedState : index < newestInsertCount ? 'entering' : 'instant';
                const enteredAt = nextState === 'entering' ? (retained ? prevEnteredAt : now) : 0;
                const dotExitToken = confirmed ? (prevRow.dotExitToken || 0) + 1 : prevRow?.dotExitToken || 0;
                if (prevRow && prevRow.state === nextState && prevRow.enteredAt === enteredAt && prevRow.msg === row.msg && prevRow.dotExitToken === dotExitToken) {
                    return prevRow;
                }
                return {
                    ...row,
                    state: nextState,
                    enteredAt,
                    dotExitToken,
                };
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

            if (sameRowList(prev.rows, result)) {
                return prev;
            }
            return { scopeKey, rows: result, animated: true };
        });
    }, [animate, presentRows, scopeKey]);

    const { instantKeys, enteringKeys } = useMemo(() => {
        const instant = [];
        const entering = [];
        for (const row of state.rows) {
            if (row.state === 'instant') {
                instant.push(row.key);
            } else if (row.state === 'entering') {
                entering.push(`${row.key}:${row.enteredAt || 0}`);
            }
        }
        return {
            instantKeys: instant.join('|'),
            enteringKeys: entering.join('|'),
        };
    }, [state.rows]);

    useEffect(() => {
        if (!state.animated || state.scopeKey !== scopeKey || !instantKeys) {
            return undefined;
        }

        const frame = requestAnimationFrame(() => {
            setState((prev) => {
                if (prev.scopeKey !== scopeKey) {
                    return prev;
                }
                return {
                    ...prev,
                    rows: prev.rows.map((row) => (row.state === 'instant' ? { ...row, state: 'present', enteredAt: 0 } : row)),
                };
            });
        });
        return () => cancelAnimationFrame(frame);
    }, [instantKeys, scopeKey, state.animated, state.scopeKey]);

    useEffect(() => {
        if (!state.animated || state.scopeKey !== scopeKey || !enteringKeys) {
            return undefined;
        }

        const now = Date.now();
        let nextDeadline = Infinity;
        for (const entry of enteringKeys.split('|')) {
            const enteredAt = Number(entry.split(':').pop());
            if (Number.isFinite(enteredAt) && enteredAt > 0) {
                nextDeadline = Math.min(nextDeadline, enteredAt + MESSAGE_ROW_ENTER_STATE_MS);
            }
        }
        if (!Number.isFinite(nextDeadline)) {
            return undefined;
        }

        const timeout = setTimeout(() => {
            setState((prev) => {
                if (prev.scopeKey !== scopeKey) {
                    return prev;
                }
                const doneAt = Date.now();
                let changed = false;
                const rows = prev.rows.map((row) => {
                    if (row.state !== 'entering') {
                        return row;
                    }
                    const enteredAt = row.enteredAt || doneAt;
                    if (doneAt - enteredAt < MESSAGE_ROW_ENTER_STATE_MS) {
                        return row;
                    }
                    changed = true;
                    return { ...row, state: 'present', enteredAt: 0 };
                });
                if (!changed) {
                    return prev;
                }
                return {
                    ...prev,
                    rows,
                };
            });
        }, Math.max(0, nextDeadline - now));

        return () => clearTimeout(timeout);
    }, [enteringKeys, scopeKey, state.animated, state.scopeKey]);

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
