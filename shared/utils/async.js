import { nonNegativeNumber } from './number.js';

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, nonNegativeNumber(ms, 0)));
}

export async function yieldToUi() {
    if (typeof requestAnimationFrame === 'function') {
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await sleep(0);
}

export function waitForIdle({ timeout = 0, delay = 0 } = {}) {
    return new Promise((resolve) => {
        const idle = globalThis?.requestIdleCallback;
        if (typeof idle === 'function') {
            idle(() => resolve(), { timeout: nonNegativeNumber(timeout, 0) });
            return;
        }
        setTimeout(resolve, nonNegativeNumber(delay, 0));
    });
}
