'use client';

const VERBOSE_DEV = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_VEYL_VERBOSE === '1';
const METHODS = ['debug', 'error', 'info', 'log', 'warn'];

if (typeof window !== 'undefined' && !VERBOSE_DEV && !window.__VEYL_CONSOLE_MUTED__) {
    window.__VEYL_CONSOLE_MUTED__ = true;
    METHODS.forEach((method) => {
        console[method] = () => {};
    });
}

export const verboseConsoleEnabled = VERBOSE_DEV;
