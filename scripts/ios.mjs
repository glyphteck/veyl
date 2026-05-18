import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function resolveIosApp(name) {
    const cwd = resolve(rootDir, 'apps', name, 'ios');
    if (!existsSync(resolve(cwd, 'package.json'))) {
        return null;
    }
    return { cwd };
}

const args = process.argv.slice(2);
const knownNetworks = new Set(['mainnet', 'regtest']);
const knownFlags = new Set(['tunnel', 'clear']);

let app = 'veyl';
let network = null;
let tunnel = false;
let clear = false;
const extra = [];

for (const arg of args) {
    if (arg === 'local') {
        console.error('The local iOS variant is no longer supported. Use dev, test, or prod.');
        process.exit(1);
    }
    if (resolveIosApp(arg)) {
        app = arg;
        continue;
    }
    if (knownNetworks.has(arg)) {
        if (network) {
            console.error('Only one iOS network can be selected.');
            process.exit(1);
        }
        network = arg;
        continue;
    }
    if (knownFlags.has(arg)) {
        if (arg === 'tunnel') {
            tunnel = true;
        }
        if (arg === 'clear') {
            clear = true;
        }
        continue;
    }
    extra.push(arg);
}

const env = { ...process.env, VEYL_IOS_VARIANT: 'dev', EXPO_PUBLIC_NETWORK: 'REGTEST' };
if (network === 'mainnet') {
    env.EXPO_PUBLIC_NETWORK = 'MAINNET';
} else if (network === 'regtest') {
    env.EXPO_PUBLIC_NETWORK = 'REGTEST';
}

const config = resolveIosApp(app);
if (!config) {
    console.error(`Unknown iOS app: ${app}`);
    process.exit(1);
}

if (clear) {
    rmSync(resolve(config.cwd, '.expo'), { recursive: true, force: true });
    rmSync(resolve(os.tmpdir(), 'metro-cache'), { recursive: true, force: true });
}

function run(command) {
    return new Promise((resolve, reject) => {
        const child = spawn('bun', command,
        {
            stdio: 'inherit',
            env,
            cwd: config.cwd,
        });

        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`bun ${command.join(' ')} failed with ${signal ? `signal ${signal}` : `code ${code}`}`));
        });

        child.on('error', reject);
    });
}

async function main() {
    const command = ['x', 'expo', 'start'];
    if (tunnel) {
        command.push('--tunnel');
    }
    if (clear) {
        command.push('--clear');
    }
    await run([...command, ...extra]);
}

try {
    await main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
