const VERBOSE_DEV = globalThis?.__DEV__ === true && (process.env.VEYL_VERBOSE === '1' || process.env.EXPO_PUBLIC_VEYL_VERBOSE === '1');
const METHODS = ['debug', 'error', 'info', 'log', 'warn'];

if (!VERBOSE_DEV && !globalThis.__VEYL_CONSOLE_MUTED__) {
    globalThis.__VEYL_CONSOLE_MUTED__ = true;
    METHODS.forEach((method) => {
        console[method] = () => {};
    });
}

export const verboseConsoleEnabled = VERBOSE_DEV;
