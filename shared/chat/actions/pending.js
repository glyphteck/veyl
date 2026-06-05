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
    const generationRef = useRef(0);
    const sentAtRef = useRef([]);
    const timerRef = useRef(null);

    function nextRateDelay() {
        const now = Date.now();
        const since = now - CHAT_SEND_QUEUE_RATE_LIMIT_WINDOW_MS;
        sentAtRef.current = sentAtRef.current.filter((ms) => ms > since);
        if (sentAtRef.current.length < CHAT_SEND_QUEUE_RATE_LIMIT_COUNT) {
            return 0;
        }
        return Math.max(0, sentAtRef.current[0] + CHAT_SEND_QUEUE_RATE_LIMIT_WINDOW_MS - now);
    }

    const flush = useCallback(() => {
        if (runningRef.current || scheduledRef.current) {
            return;
        }

        scheduledRef.current = true;
        const delay = nextRateDelay();
        timerRef.current = setTimeout(async () => {
            timerRef.current = null;
            scheduledRef.current = false;
            if (runningRef.current) {
                return;
            }

            const job = queueRef.current.shift();
            if (!job) {
                return;
            }

            runningRef.current = true;
            sentAtRef.current = [...sentAtRef.current, Date.now()].slice(-CHAT_SEND_QUEUE_RATE_LIMIT_COUNT);
            try {
                const updatePreview = job.previewRequired || !queueRef.current.some((item) => item.previewKey && item.previewKey === job.previewKey);
                const result = await job.run({ updatePreview });
                job.onSuccess?.();
                job.resolve?.(result);
            } catch (error) {
                job.onError?.(error);
                job.reject?.(error);
            } finally {
                runningRef.current = false;
                if (queueRef.current.length) {
                    flush();
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
        sentAtRef.current = [];
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
