'use client';

import { useCallback, useRef } from 'react';
import { CHAT_SEND_QUEUE_RATE_LIMIT_COUNT, CHAT_SEND_QUEUE_RATE_LIMIT_WINDOW_MS } from '../../config.js';

function asTargets(targets) {
    return (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
}

export function usePendingSendQueue() {
    const queueRef = useRef([]);
    const runningRef = useRef(false);
    const scheduledRef = useRef(false);
    const syncingRef = useRef(false);
    const generationRef = useRef(0);
    const sentAtRef = useRef([]);
    const timerRef = useRef(null);
    const pendingLastMsgRef = useRef(new Map());

    function nextRateDelay() {
        const now = Date.now();
        const since = now - CHAT_SEND_QUEUE_RATE_LIMIT_WINDOW_MS;
        sentAtRef.current = sentAtRef.current.filter((ms) => ms > since);
        if (sentAtRef.current.length < CHAT_SEND_QUEUE_RATE_LIMIT_COUNT) {
            return 0;
        }
        return Math.max(0, sentAtRef.current[0] + CHAT_SEND_QUEUE_RATE_LIMIT_WINDOW_MS - now);
    }

    function rememberLastMsg(job, result) {
        if (!job?.lastMsgKey || job.lastMsgRequired || !result?.lastMsg || typeof job.syncLastMsg !== 'function') {
            return;
        }
        pendingLastMsgRef.current.set(job.lastMsgKey, {
            lastMsg: result.lastMsg,
            syncLastMsg: job.syncLastMsg,
        });
    }

    function flushPendingLastMsgs() {
        if (syncingRef.current || runningRef.current || scheduledRef.current || !pendingLastMsgRef.current.size) {
            return;
        }

        const generation = generationRef.current;
        const items = [...pendingLastMsgRef.current.values()];
        pendingLastMsgRef.current = new Map();
        syncingRef.current = true;
        Promise.allSettled(items.map((item) => item.syncLastMsg(item.lastMsg)))
            .then((results) => {
                for (const result of results) {
                    if (result.status === 'rejected') {
                        console.warn('chat last message sync failed', result.reason);
                    }
                }
            })
            .finally(() => {
                if (generation !== generationRef.current) {
                    return;
                }
                syncingRef.current = false;
                if (queueRef.current.length) {
                    flush();
                } else if (pendingLastMsgRef.current.size) {
                    flushPendingLastMsgs();
                }
            });
    }

    const flush = useCallback(() => {
        if (runningRef.current || scheduledRef.current || syncingRef.current) {
            return;
        }

        scheduledRef.current = true;
        const delay = nextRateDelay();
        timerRef.current = setTimeout(async () => {
            timerRef.current = null;
            scheduledRef.current = false;
            if (runningRef.current || syncingRef.current) {
                return;
            }

            const job = queueRef.current.shift();
            if (!job) {
                return;
            }

            runningRef.current = true;
            sentAtRef.current = [...sentAtRef.current, Date.now()].slice(-CHAT_SEND_QUEUE_RATE_LIMIT_COUNT);
            try {
                const result = await job.run({ updateLastMsg: job.lastMsgRequired });
                rememberLastMsg(job, result);
                job.onSuccess?.();
                job.resolve?.(result);
            } catch (error) {
                job.onError?.(error);
                job.reject?.(error);
            } finally {
                runningRef.current = false;
                if (queueRef.current.length) {
                    flush();
                } else {
                    flushPendingLastMsgs();
                }
            }
        }, delay);
    }, []);

    const enqueuePendingSendJob = useCallback(
        (targets, job, { reject, waitForTarget } = {}) => {
            const generation = generationRef.current;
            Promise.all(asTargets(targets).map((target) => waitForTarget?.(target) ?? Promise.resolve()))
                .then(() => {
                    if (generation !== generationRef.current) {
                        const error = new Error('chat reset');
                        job.onError?.(error);
                        reject?.(error);
                        return;
                    }

                    queueRef.current.push(job);
                    flush();
                })
                .catch((error) => {
                    job.onError?.(error);
                    reject?.(error);
                });
        },
        [flush]
    );

    const resetPendingSendQueue = useCallback(() => {
        generationRef.current += 1;
        if (queueRef.current.length) {
            const error = new Error('chat reset');
            queueRef.current.forEach((job) => {
                job.onError?.(error);
                job.reject?.(error);
            });
        }
        queueRef.current = [];
        runningRef.current = false;
        scheduledRef.current = false;
        syncingRef.current = false;
        sentAtRef.current = [];
        pendingLastMsgRef.current = new Map();
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    return {
        enqueuePendingSendJob,
        resetPendingSendQueue,
    };
}
