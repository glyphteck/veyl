import { AppState, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';

const DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}diagnostics/` : null;
const FILE = DIR ? `${DIR}breadcrumbs.log` : null;
const MAX_LINES = 120;
const SAFE_STRING_KEYS = new Set([
    'accessPrivileges',
    'appVersion',
    'build',
    'code',
    'contentType',
    'executionEnvironment',
    'facing',
    'firstType',
    'kind',
    'lockState',
    'mimeType',
    'orientation',
    'platform',
    'phase',
    'reason',
    'resize',
    'route',
    'source',
    'stage',
    'state',
    'status',
    'type',
]);
const SENSITIVE_STRING_KEYS = new Set(['chatId', 'deviceId', 'message', 'name', 'path', 'pathname', 'stack', 'to', 'uri']);

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

function redactValue(value, key = '') {
    if (value == null || typeof value === 'boolean' || typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        if (SAFE_STRING_KEYS.has(key)) {
            return value;
        }
        if (SENSITIVE_STRING_KEYS.has(key)) {
            return value ? '[redacted]' : '';
        }
        return value.length <= 24 && /^[a-z0-9_.:-]+$/i.test(value) ? value : '[redacted]';
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, key));
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
    }
    return '[redacted]';
}

function line(label, data) {
    const payload = data == null ? '' : ` ${safeJson(redactValue(data))}`;
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

function clearConsoleForBundleReload() {
    if (Platform.OS !== 'ios') return;
    console.clear?.();
}

export function mark(label, data) {
    const nextLine = line(label, data);
    console.log(`[diag] ${nextLine}`);
    persist(nextLine);
}

async function clearPrevious() {
    if (!FILE) return;
    await ensureDir();
    lines = [];
    await FileSystem.deleteAsync(FILE, { idempotent: true }).catch(() => {});
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
    clearConsoleForBundleReload();
    void clearPrevious().finally(() => {
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
