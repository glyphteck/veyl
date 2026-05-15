import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { webApps } from '../shared/links.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDefaults = {
    veyl: {
        port: webApps.veyl.port,
        hostname: webApps.veyl.domain,
        https: true,
    },
};

function resolveAppDir(name, kind) {
    const nested = resolve(rootDir, 'apps', name, kind);
    if (existsSync(resolve(nested, 'package.json'))) {
        return nested;
    }

    if (kind === 'web') {
        const flat = resolve(rootDir, 'apps', name);
        if (existsSync(resolve(flat, 'package.json'))) {
            return flat;
        }
    }

    return null;
}

function resolveWebApp(name) {
    const cwd = resolveAppDir(name, 'web');
    if (!cwd) {
        return null;
    }

    return {
        cwd,
        ...webDefaults[name],
    };
}

function getPortOwner(port) {
    try {
        const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const [, line] = output.split('\n');
        if (!line) {
            return null;
        }
        const parts = line.trim().split(/\s+/);
        const [command, pid] = parts;
        if (!command || !pid) {
            return null;
        }
        return { command, pid };
    } catch {
        return null;
    }
}

async function assertPortOpen(config) {
    if (!config.port) {
        return;
    }

    await new Promise((resolvePromise, rejectPromise) => {
        const server = net.createServer();
        server.once('error', (error) => {
            if (error?.code !== 'EADDRINUSE') {
                rejectPromise(error);
                return;
            }
            const owner = getPortOwner(config.port);
            const appUrl = `${config.https ? 'https' : 'http'}://${config.hostname}:${config.port}`;
            const ownerText = owner ? ` by ${owner.command} (pid ${owner.pid})` : '';
            rejectPromise(new Error(`Port ${config.port} is already in use${ownerText}. ${appUrl} must stay on that port for local veyl auth. Stop the existing process and try again.`));
        });
        server.listen({
            port: Number(config.port),
            host: '127.0.0.1',
            exclusive: true,
        }, () => {
            server.close((closeError) => {
                if (closeError) {
                    rejectPromise(closeError);
                    return;
                }
                resolvePromise();
            });
        });
    });
}

const args = process.argv.slice(2);
const knownNetworks = new Set(['mainnet', 'regtest']);
const knownFlags = new Set(['clear']);

let app = 'veyl';
let network = null;
let clear = false;
const extra = [];

for (const arg of args) {
    if (resolveWebApp(arg)) {
        app = arg;
        continue;
    }
    if (knownNetworks.has(arg)) {
        if (network) {
            console.error('Only one web network can be selected.');
            process.exit(1);
        }
        network = arg;
        continue;
    }
    if (knownFlags.has(arg)) {
        if (arg === 'clear') {
            clear = true;
        }
        continue;
    }
    extra.push(arg);
}

const env = { ...process.env };
if (network === 'mainnet') {
    env.NEXT_PUBLIC_NETWORK = 'MAINNET';
} else if (network === 'regtest') {
    env.NEXT_PUBLIC_NETWORK = 'REGTEST';
}

const config = resolveWebApp(app);
if (!config) {
    console.error(`Unknown web app: ${app}`);
    process.exit(1);
}

try {
    await assertPortOpen(config);
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}

if (clear) {
    rmSync(resolve(config.cwd, '.next'), { recursive: true, force: true });
}

const command = ['x', 'next', 'dev', '--turbopack'];
if (config.hostname) {
    command.push('--hostname', config.hostname);
}
if (config.port) {
    command.push('--port', config.port);
}
if (config.https) {
    command.push('--experimental-https');
}
command.push(...extra);

const child = spawn('bun', command, { stdio: 'inherit', env, cwd: config.cwd });

child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
});

child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
});
