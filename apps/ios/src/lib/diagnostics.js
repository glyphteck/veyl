import { AppState, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { ensureDirectory } from '@/lib/file';
import { verboseConsoleEnabled } from '@/lib/console';

const DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}diagnostics/` : null;
const FILE = DIR ? `${DIR}breadcrumbs.log` : null;
const ENABLED = verboseConsoleEnabled;
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
let persistTimer = null;

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

function flushPersist() {
    if (!ENABLED || !FILE) return;
    const payload = `${lines.join('\n')}\n`;
    writeChain = writeChain
        .then(async () => {
            if (!(await ensureDirectory(DIR, { quiet: true }))) return;
            await FileSystem.writeAsStringAsync(FILE, payload).catch(() => {});
        })
        .catch(() => {});
}

function persist(nextLine) {
    if (!ENABLED || !FILE) return;
    lines = [...lines, nextLine].slice(-MAX_LINES);
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        flushPersist();
    }, 500);
}

function clearConsoleForBundleReload() {
    if (!ENABLED) return;
    if (Platform.OS !== 'ios') return;
    console.clear?.();
}

export function mark(label, data) {
    if (!ENABLED) return;
    const nextLine = line(label, data);
    console.log(`[diag] ${nextLine}`);
    persist(nextLine);
}

async function clearPrevious() {
    if (!ENABLED || !FILE) return;
    await ensureDirectory(DIR, { quiet: true });
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
    if (!ENABLED) return;
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
