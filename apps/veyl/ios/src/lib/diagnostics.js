import { AppState, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';

const DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}diagnostics/` : null;
const FILE = DIR ? `${DIR}breadcrumbs.log` : null;
const MAX_LINES = 120;

let installed = false;
let writeChain = Promise.resolve();
let lines = [];

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return '"[unserializable]"';
    }
}

function line(label, data) {
    const payload = data == null ? '' : ` ${safeJson(data)}`;
    return `${new Date().toISOString()} ${label}${payload}`;
}

async function ensureDir() {
    if (!DIR) return false;
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    return true;
}

function persist(nextLine) {
    if (!FILE) return;
    lines = [...lines, nextLine].slice(-MAX_LINES);
    writeChain = writeChain
        .then(async () => {
            if (!(await ensureDir())) return;
            await FileSystem.writeAsStringAsync(FILE, `${lines.join('\n')}\n`).catch(() => {});
        })
        .catch(() => {});
}

export function mark(label, data) {
    const nextLine = line(label, data);
    console.log(`[diag] ${nextLine}`);
    persist(nextLine);
}

async function loadPrevious() {
    if (!FILE) return;
    await ensureDir();
    const previous = await FileSystem.readAsStringAsync(FILE).catch(() => '');
    lines = previous
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(-MAX_LINES);
    if (lines.length) {
        console.log(`[diag] previous breadcrumbs\n${lines.slice(-40).join('\n')}`);
    }
}

function installErrorHandler() {
    const errorUtils = global.ErrorUtils;
    const previous = errorUtils?.getGlobalHandler?.();
    if (errorUtils?.setGlobalHandler) {
        errorUtils.setGlobalHandler((error, fatal) => {
            mark('js.error', {
                fatal: !!fatal,
                message: error?.message || String(error),
                stack: error?.stack || '',
            });
            previous?.(error, fatal);
        });
    }

    const rejectionTracker = global.HermesInternal?.hasPromise?.() ? global.__promiseRejectionTrackingOptions : null;
    if (rejectionTracker && !rejectionTracker.onUnhandled) {
        rejectionTracker.onUnhandled = (_id, error) => {
            mark('js.unhandledRejection', {
                message: error?.message || String(error),
                stack: error?.stack || '',
            });
        };
    }
}

export function installDiagnostics() {
    if (installed) return;
    installed = true;
    void loadPrevious().finally(() => {
        mark('app.boot', {
            appVersion: Constants.expoConfig?.version || '',
            build: Constants.expoConfig?.ios?.buildNumber || '',
            executionEnvironment: Constants.executionEnvironment || '',
            platform: Platform.OS,
            osVersion: Platform.Version,
        });
    });
    installErrorHandler();
    AppState.addEventListener('change', (state) => {
        mark('app.state', { state });
    });
}
