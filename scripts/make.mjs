import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFunctionsLinks, writeIosLinks, writeStorageCors } from './links.mjs';

const [target, ...rest] = process.argv.slice(2);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

        return {
            installId: device.identifier || device.hardwareProperties?.udid || selector,
            xcodeId: device.hardwareProperties?.udid || device.identifier || selector,
        };
    } finally {
        rmSync(tmp, { force: true, recursive: true });
    }
}

async function buildAndInstallIos({ iosDir, iosArgs, reset, settings, env }) {
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

    await run(
        'xcodebuild',
        [
            ...projectArgs,
            '-quiet',
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
        }
    );

    if (!existsSync(appPath)) {
        throw new Error(`Built iOS app was not found at ${appPath}`);
    }

    if (reset) {
        await run('xcrun', ['devicectl', 'device', 'uninstall', 'app', '--device', device.installId, settings.bundleIdentifier, '--timeout', '60']).catch((error) => {
            console.warn(`iOS reset uninstall skipped: ${error.message}`);
        });
    }

    await run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.installId, appPath, '--timeout', '120']);
    await run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', device.installId, '--terminate-existing', '--quiet', settings.bundleIdentifier]);
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
                { cwd: iosDir, env: { ...process.env, VEYL_IOS_VARIANT: 'prod', EXPO_PUBLIC_NETWORK: 'MAINNET' } }
            );
            return;
        }

        const settings = iosVariants[variant];
        const env = {
            ...process.env,
            VEYL_IOS_VARIANT: variant,
            VEYL_LOCAL_IOS_BUILD: '1',
            ...(settings.associatedDomainsMode ? { VEYL_ASSOCIATED_DOMAINS_MODE: settings.associatedDomainsMode } : {}),
            EXPO_PUBLIC_NETWORK: settings.network,
        };

        await run('bun', ['x', 'expo', 'prebuild', '-p', 'ios'], { cwd: iosDir, env });
        await buildAndInstallIos({ iosDir, iosArgs, reset, settings, env });
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

    console.error('Usage: bun make <ios|backend|db|rules|fns|cors|lifecycle>');
    console.error('Examples: bun make ios, bun make ios reset, bun make ios test, bun make ios prod, bun make ios store');
    process.exitCode = 1;
}

await main();
