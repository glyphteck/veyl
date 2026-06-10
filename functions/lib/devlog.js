const VERBOSE_DEV = typeof process !== 'undefined' && process.env?.VEYL_VERBOSE === '1' && process.env?.FUNCTIONS_EMULATOR === 'true';

export function devLog(...args) {
    if (VERBOSE_DEV) {
        console.log(...args);
    }
}

export function devWarn(...args) {
    if (VERBOSE_DEV) {
        console.warn(...args);
    }
}

export function devError(...args) {
    if (VERBOSE_DEV) {
        console.error(...args);
    }
}
