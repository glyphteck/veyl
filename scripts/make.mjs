import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import { uniqueValues } from '@veyl/shared/utils/array';
import { writeFunctionsLinks, writeIosLinks, writeStorageCors } from './links.mjs';

const rawArgs = process.argv.slice(2);
const verbose = rawArgs.includes('-v') || rawArgs.includes('--verbose');
const [target, ...rest] = rawArgs.filter((arg) => arg !== '-v' && arg !== '--verbose');
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const firebaseTargets = {
    backend: 'firestore:rules,firestore:indexes,storage,functions',
    db: 'firestore:indexes',
    rules: 'firestore:rules,storage',
    fns: 'functions',
};
const storageBucket = 'gs://glyphteck.firebasestorage.app';
const storageLifecyclePath = resolve(rootDir, 'storage.lifecycle.json');
const appleTeamId = 'HHTM355M49';
const iosVariants = {
    dev: {
        associatedDomainsMode: 'developer',
        bundleIdentifier: 'com.glyphteck.veyl.dev',
        configuration: 'Debug',
        network: 'REGTEST',
        scheme: 'devveyl',
    },
    test: {
        associatedDomainsMode: 'developer',
        bundleIdentifier: 'com.glyphteck.veyl.test',
        configuration: 'Release',
        network: 'REGTEST',
        scheme: 'testveyl',
    },
    prod: {
        bundleIdentifier: 'com.glyphteck.veyl',
        configuration: 'Release',
        network: 'MAINNET',
        scheme: 'veyl',
    },
};

function resolveIosDir(name) {
    const cwd = resolve(rootDir, 'apps', name, 'ios');
    if (!existsSync(resolve(cwd, 'package.json'))) {
        return null;
    }
    return cwd;
}

function run(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            stdio: 'inherit',
            ...options,
        });

        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`${cmd} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `code ${code}`}`));
        });

        child.on('error', reject);
    });
}

function cleanLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function outputLines(output) {
    return String(output || '')
        .split(/\r?\n/)
        .map(cleanLine)
        .filter(Boolean);
}

function clipLine(value) {
    const line = cleanLine(value);
    return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}

function logSlug(value) {
    return cleanLine(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'command';
}

function displayPath(file) {
    const path = relative(rootDir, file);
    return path && !path.startsWith('..') ? path : file;
}

function warningLines(output) {
    return outputLines(output).filter((line) => /\bwarn(?:ing)?\b/i.test(line));
}

function failureLine(output) {
    const lines = outputLines(output);
    return (
        lines.find((line) => /\b(error|failed|unable|denied)\b/i.test(line))
        || lines.at(-1)
        || ''
    );
}

function failureDetailLines(output, limit = 4) {
    const details = [];
    for (const line of outputLines(output)) {
        if (!/\b(error|failed|unable|denied|cannot|not found)\b/i.test(line)) {
            continue;
        }

        const clipped = clipLine(line);
        if (!details.includes(clipped)) {
            details.push(clipped);
        }

        if (details.length >= limit) {
            break;
        }
    }

    return details;
}

function emitWarningSummary(label, output) {
    const lines = uniqueValues(warningLines(output).map(clipLine));
    if (!lines.length) {
        return;
    }

    console.warn(`warning: ${label}: ${lines.length} warning${lines.length === 1 ? '' : 's'}${lines[0] ? `; ${lines[0]}` : ''}`);
}

function writeTextLog(file, contents) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents.endsWith('\n') ? contents : `${contents}\n`);
}

function writeRunLogs(label, output, logDir) {
    if (!logDir) {
        return {};
    }

    const slug = logSlug(label);
    const fullLog = resolve(logDir, `${slug}.log`);
    writeTextLog(fullLog, String(output || ''));

    const warnings = uniqueValues(warningLines(output));
    if (!warnings.length) {
        return { fullLog };
    }

    const warningLog = resolve(logDir, `${slug}.warnings.log`);
    writeTextLog(warningLog, warnings.join('\n'));
    status(`${label}: ${warnings.length} warning${warnings.length === 1 ? '' : 's'} logged to ${displayPath(warningLog)}`);
    return { fullLog, warningLog };
}

function makeCommandError(cmd, args, code, signal, output, logPath, label = cmd) {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    const details = failureDetailLines(output);
    const fallback = clipLine(failureLine(output));
    const error = new Error(`${label} failed with ${reason}`);
    error.command = `${cmd} ${args.join(' ')}`;
    error.details = details.length ? details : fallback ? [fallback] : [];
    error.logPath = logPath ? displayPath(logPath) : '';
    error.output = output;
    return error;
}

function runQuiet(cmd, args, options = {}) {
    const { label = cmd, reject = true, logDir, ...spawnOptions } = options;

    if (verbose) {
        return new Promise((resolve, rejectRun) => {
            const child = spawn(cmd, args, {
                stdio: ['inherit', 'pipe', 'pipe'],
                ...spawnOptions,
            });
            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (chunk) => {
                stdout += chunk;
                process.stdout.write(chunk);
            });
            child.stderr?.on('data', (chunk) => {
                stderr += chunk;
                process.stderr.write(chunk);
            });

            child.on('exit', (code, signal) => {
                const output = [stderr, stdout].filter(Boolean).join('\n');
                const logs = writeRunLogs(label, output, logDir);
                const result = { code, signal, stdout, stderr, output, ...logs };
                if (code === 0 || !reject) {
                    resolve(result);
                    return;
                }

                rejectRun(makeCommandError(cmd, args, code, signal, output, logs.fullLog, label));
            });

            child.on('error', rejectRun);
        });
    }

    return new Promise((resolve, rejectRun) => {
        const child = spawn(cmd, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            ...spawnOptions,
        });
        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk;
        });

        child.on('exit', (code, signal) => {
            const output = [stderr, stdout].filter(Boolean).join('\n');
            const logs = writeRunLogs(label, output, logDir);
            const result = { code, signal, stdout, stderr, output, ...logs };
            if (!logDir) {
                emitWarningSummary(label, output);
            }

            if (code === 0 || !reject) {
                resolve(result);
                return;
            }

            rejectRun(makeCommandError(cmd, args, code, signal, output, logs.fullLog, label));
        });

        child.on('error', rejectRun);
    });
}

function runCapture(cmd, args, options = {}) {
    const result = spawnSync(cmd, args, {
        encoding: 'utf8',
        ...options,
    });
    if (result.status === 0) {
        return result.stdout;
    }

    throw new Error(`${cmd} ${args.join(' ')} failed with ${result.signal ? `signal ${result.signal}` : `code ${result.status}`}`);
}

function resolveIosDevice(selector) {
    const tmp = mkdtempSync(resolve(tmpdir(), 'veyl-ios-device-'));
    const jsonPath = resolve(tmp, 'devices.json');

    try {
        runCapture('xcrun', ['devicectl', 'list', 'devices', '--json-output', jsonPath], { stdio: 'pipe' });
        const devices = JSON.parse(readFileSync(jsonPath, 'utf8'))?.result?.devices || [];
        const available = devices.filter((device) => device?.connectionProperties?.pairingState === 'paired');
        const device = available.find((candidate) => {
            const name = candidate?.deviceProperties?.name;
            const identifier = candidate?.identifier;
            const udid = candidate?.hardwareProperties?.udid;
            const serial = candidate?.hardwareProperties?.serialNumber;
            const hostnames = candidate?.connectionProperties?.potentialHostnames || [];
            return [name, identifier, udid, serial, ...hostnames].includes(selector);
        });

        if (!device) {
            throw new Error(`Unable to find paired iOS device "${selector}".`);
        }

        const udid = device.hardwareProperties?.udid;
        const identifier = device.identifier;

        return {
            installId: udid || identifier || selector,
            xcodeId: udid || identifier || selector,
        };
    } finally {
        rmSync(tmp, { force: true, recursive: true });
    }
}

function status(line) {
    console.log(line);
}

function lockedLaunch(output) {
    return /BSErrorCodeDescription = Locked|reason: Locked|because the device was not, or could not be, unlocked/i.test(output);
}

async function buildAndInstallIos({ iosDir, iosArgs, reset, settings, env, logDir }) {
    const device = resolveIosDevice(process.env.VEYL_IOS_DEVICE || 'zak 15');
    const iosNativeDir = resolve(iosDir, 'ios');
    const workspace = resolve(iosNativeDir, `${settings.scheme}.xcworkspace`);
    const project = resolve(iosNativeDir, `${settings.scheme}.xcodeproj`);
    const buildRoot = resolve(iosNativeDir, 'build', settings.scheme);
    const derivedDataPath = resolve(buildRoot, 'DerivedData');
    const appPath = resolve(derivedDataPath, 'Build', 'Products', `${settings.configuration}-iphoneos`, `${settings.scheme}.app`);
    const projectArgs = existsSync(workspace)
        ? ['-workspace', workspace]
        : ['-project', project];

    status(`ios ${settings.scheme}: build`);
    await runQuiet(
        'xcodebuild',
        [
            ...projectArgs,
            ...(verbose ? [] : ['-quiet']),
            '-scheme',
            settings.scheme,
            '-configuration',
            settings.configuration,
            '-destination',
            `id=${device.xcodeId}`,
            '-derivedDataPath',
            derivedDataPath,
            `DEVELOPMENT_TEAM=${appleTeamId}`,
            '-allowProvisioningUpdates',
            '-allowProvisioningDeviceRegistration',
            ...iosArgs,
            'build',
        ],
        {
            cwd: iosDir,
            env: {
                ...env,
                RCT_METRO_PORT: process.env.RCT_METRO_PORT || '8081',
                RCT_NO_LAUNCH_PACKAGER: 'true',
            },
            label: 'ios build',
            logDir,
        }
    );

    if (!existsSync(appPath)) {
        throw new Error(`Built iOS app was not found at ${appPath}`);
    }

    if (reset) {
        status(`ios ${settings.scheme}: reset`);
        await runQuiet('xcrun', ['devicectl', 'device', 'uninstall', 'app', '--device', device.installId, settings.bundleIdentifier, '--timeout', '60'], { label: 'ios reset', logDir }).catch((error) => {
            status(`ios ${settings.scheme}: reset skipped; ${error.message}`);
        });
    }

    status(`ios ${settings.scheme}: install`);
    await runQuiet('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.installId, appPath, '--timeout', '120'], { label: 'ios install', logDir });

    status(`ios ${settings.scheme}: launch`);
    const launchArgs = ['devicectl', 'device', 'process', 'launch', '--device', device.installId, '--terminate-existing', ...(verbose ? [] : ['--quiet']), settings.bundleIdentifier];
    const launch = await runQuiet('xcrun', launchArgs, { label: 'ios launch', reject: false, logDir });
    if (launch.code === 0) {
        status(`ios ${settings.scheme}: launched ${settings.bundleIdentifier}`);
        return;
    }

    if (lockedLaunch(launch.output)) {
        status(`ios ${settings.scheme}: launch skipped; device is locked, open ${settings.bundleIdentifier} after unlocking`);
        return;
    }

    throw makeCommandError('xcrun', launchArgs, launch.code, launch.signal, launch.output, launch.fullLog, 'ios launch');
}

async function main() {
    if (target === 'ios') {
        let app = 'veyl';
        let iosArgs = rest;

        if (rest[0] && resolveIosDir(rest[0])) {
            app = rest[0];
            iosArgs = rest.slice(1);
        }
        const reset = iosArgs.includes('reset');
        iosArgs = iosArgs.filter((arg) => arg !== 'reset');
        if (iosArgs[0] === 'local') {
            throw new Error('The local iOS variant is no longer supported. Use dev, test, or prod.');
        }

        const variantAliases = {
            production: 'prod',
        };
        const requestedVariant = iosArgs[0] && ['dev', 'test', 'prod', 'production', 'store'].includes(iosArgs[0])
            ? iosArgs[0]
            : 'dev';
        const variant = variantAliases[requestedVariant] || requestedVariant;
        iosArgs = requestedVariant === 'dev' && iosArgs[0] !== 'dev' ? iosArgs : iosArgs.slice(1);

        const iosDir = resolveIosDir(app);
        if (!iosDir) {
            console.error(`Unknown iOS app: ${app}`);
            process.exitCode = 1;
            return;
        }

        await writeIosLinks();

        if (variant === 'store') {
            await run(
                'bun',
                [
                    'x',
                    'eas-cli',
                    'build',
                    '--platform',
                    'ios',
                    '--profile',
                    'prod',
                    '--wait',
                    ...iosArgs,
                ],
                { cwd: iosDir, env: { ...process.env, VEYL_IOS_VARIANT: 'prod', EXPO_PUBLIC_VEYL_VARIANT: 'prod', EXPO_PUBLIC_NETWORK: 'MAINNET' } }
            );
            return;
        }

        const settings = iosVariants[variant];
        const env = {
            ...process.env,
            VEYL_IOS_VARIANT: variant,
            EXPO_PUBLIC_VEYL_VARIANT: variant,
            VEYL_LOCAL_IOS_BUILD: '1',
            ...(settings.associatedDomainsMode ? { VEYL_ASSOCIATED_DOMAINS_MODE: settings.associatedDomainsMode } : {}),
            EXPO_PUBLIC_NETWORK: settings.network,
        };
        const logDir = resolve(iosDir, 'ios', 'build', settings.scheme, 'logs', runStamp);
        status(`ios ${settings.scheme}: logs ${displayPath(logDir)}`);

        status(`ios ${settings.scheme}: clean prebuild`);
        await runQuiet('bun', ['x', 'expo', 'prebuild', '-p', 'ios', '--clean'], { cwd: iosDir, env, label: 'ios prebuild', logDir });
        await buildAndInstallIos({ iosDir, iosArgs, reset, settings, env, logDir });
        return;
    }

    if (target && firebaseTargets[target]) {
        if (firebaseTargets[target].includes('functions')) {
            await writeFunctionsLinks();
        }
        await run('firebase', ['deploy', '--only', firebaseTargets[target], ...rest]);
        if (target === 'backend' || target === 'rules') {
            await writeStorageCors();
            await run('gcloud', ['storage', 'buckets', 'update', storageBucket, '--cors-file', resolve(rootDir, 'storage.cors.json')]);
            await run('gcloud', ['storage', 'buckets', 'update', storageBucket, '--lifecycle-file', storageLifecyclePath]);
        }
        return;
    }

    if (target === 'cors') {
        await writeStorageCors();
        await run('gcloud', ['storage', 'buckets', 'update', storageBucket, '--cors-file', resolve(rootDir, 'storage.cors.json'), ...rest]);
        return;
    }

    if (target === 'lifecycle') {
        await run('gcloud', ['storage', 'buckets', 'update', storageBucket, '--lifecycle-file', storageLifecyclePath, ...rest]);
        return;
    }

    console.error('Usage: bun make [-v|--verbose] <ios|backend|db|rules|fns|cors|lifecycle>');
    console.error('Examples: bun make ios, bun make ios reset, bun make ios test, bun make ios prod, bun make ios store');
    process.exitCode = 1;
}

try {
    await main();
} catch (error) {
    console.error(`error: ${cleanLine(error?.message || error)}`);
    for (const detail of error?.details || []) {
        console.error(`error detail: ${detail}`);
    }
    if (error?.logPath) {
        console.error(`error log: ${error.logPath}`);
    }
    if (!verbose && error?.command) {
        console.error('rerun with -v or --verbose for full command output');
    }
    process.exitCode = 1;
}
