import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

async function main() {
    if (target === 'ios') {
        let app = 'veyl';
        let iosArgs = rest;
        let local = false;

        if (rest[0] && resolveIosDir(rest[0])) {
            app = rest[0];
            iosArgs = rest.slice(1);
        }
        if (iosArgs[0] === 'local') {
            local = true;
            iosArgs = iosArgs.slice(1);
        }

        const iosDir = resolveIosDir(app);
        if (!iosDir) {
            console.error(`Unknown iOS app: ${app}`);
            process.exitCode = 1;
            return;
        }

        await writeIosLinks();

        if (iosArgs[0] === 'prod' || iosArgs[0] === 'production') {
            const prodArgs = iosArgs.slice(1);
            await run(
                'bun',
                [
                    'x',
                    'eas-cli',
                    'build',
                    '--platform',
                    'ios',
                    '--profile',
                    'production',
                    '--wait',
                    ...prodArgs,
                ],
                { cwd: iosDir, env: { ...process.env, VEYL_IOS_VARIANT: 'prod', EXPO_PUBLIC_NETWORK: 'MAINNET' } }
            );
            return;
        }

        const env = local
            ? { ...process.env, VEYL_IOS_VARIANT: 'local', EXPO_PUBLIC_NETWORK: 'REGTEST' }
            : process.env;
        const runArgs = local
            ? ['exec', 'expo', 'run:ios', '--device', process.env.VEYL_IOS_DEVICE || 'zak 15', '--configuration', 'Release', '--no-bundler', ...iosArgs]
            : ['exec', 'expo', 'run:ios', '--device', process.env.VEYL_IOS_DEVICE || 'zak 15', ...iosArgs];

        await run('bun', ['x', 'expo', 'prebuild', '-p', 'ios'], { cwd: iosDir, env });
        await run('bun', ['x', ...runArgs.slice(1)], { cwd: iosDir, env });
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
        }
        return;
    }

    if (target === 'cors') {
        await writeStorageCors();
        await run('gcloud', ['storage', 'buckets', 'update', storageBucket, '--cors-file', resolve(rootDir, 'storage.cors.json'), ...rest]);
        return;
    }

    console.error('Usage: bun make <ios|backend|db|rules|fns|cors>');
    console.error('Examples: bun make ios, bun make ios local, bun make ios prod');
    process.exitCode = 1;
}

await main();
