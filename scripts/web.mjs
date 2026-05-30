import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { webApps } from '../shared/links.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultWebCacheMaxBytes = 5 * 1024 * 1024 * 1024;
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

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let size = bytes / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && size >= 1024; i += 1) {
        size /= 1024;
        unit = units[i];
    }
    return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

function dirSizeBytes(path) {
    let size = 0;
    const stack = [path];
    while (stack.length) {
        const current = stack.pop();
        let stat;
        try {
            stat = lstatSync(current);
        } catch {
            continue;
        }
        if (!stat.isDirectory()) {
            size += stat.size;
            continue;
        }
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            stack.push(resolve(current, entry.name));
        }
    }
    return size;
}

function webCacheMaxBytes(env) {
    const gb = Number(env.VEYL_WEB_CACHE_MAX_GB);
    if (!Number.isFinite(gb) || gb <= 0) {
        return defaultWebCacheMaxBytes;
    }
    return gb * 1024 * 1024 * 1024;
}

function maybeClearNextCache(config, force, env) {
    const nextDir = resolve(config.cwd, '.next');
    if (force) {
        rmSync(nextDir, { recursive: true, force: true });
        return;
    }
    if (!existsSync(nextDir)) {
        return;
    }
    const maxBytes = webCacheMaxBytes(env);
    const currentBytes = dirSizeBytes(nextDir);
    if (currentBytes <= maxBytes) {
        return;
    }
    console.warn(`[web] .next cache is ${formatBytes(currentBytes)}; clearing before launch because it exceeds ${formatBytes(maxBytes)}.`);
    rmSync(nextDir, { recursive: true, force: true });
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
const knownFlags = new Set(['clear', 'inspect', 'mem', 'trace']);

let app = 'veyl';
let network = null;
let clear = false;
let inspect = false;
let memoryDebug = false;
let trace = false;
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
        if (arg === 'inspect') {
            inspect = true;
        }
        if (arg === 'mem') {
            memoryDebug = true;
        }
        if (arg === 'trace') {
            trace = true;
        }
        continue;
    }
    extra.push(arg);
}

const env = { ...process.env };
const nodeOptions = new Set(String(env.NODE_OPTIONS || '').split(/\s+/).filter(Boolean));
if (inspect) {
    nodeOptions.add('--inspect');
}
if (memoryDebug) {
    nodeOptions.add('--heapsnapshot-near-heap-limit=3');
}
if (nodeOptions.size) {
    env.NODE_OPTIONS = [...nodeOptions].join(' ');
}
if (trace) {
    env.NEXT_TURBOPACK_TRACING = '1';
}
if (network === 'mainnet') {
    env.NEXT_PUBLIC_NETWORK = 'MAINNET';
} else if (network === 'regtest') {
    env.NEXT_PUBLIC_NETWORK = 'REGTEST';
}
if (!env.NEXT_PUBLIC_VEYL_VARIANT) {
    env.NEXT_PUBLIC_VEYL_VARIANT = 'dev';
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

maybeClearNextCache(config, clear, env);

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
const warnMb = Number(env.VEYL_WEB_MEMORY_WARN_MB || 3200);
const checkMs = Number(env.VEYL_WEB_MEMORY_CHECK_MS || (memoryDebug ? 10000 : 30000));
let lastMemoryWarning = 0;

function childPids(pid) {
    try {
        return execFileSync('pgrep', ['-P', String(pid)], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(Number);
    } catch {
        return [];
    }
}

function processTree(pid, seen = new Set()) {
    if (!pid || seen.has(pid)) {
        return [];
    }
    seen.add(pid);
    return [pid, ...childPids(pid).flatMap((childPid) => processTree(childPid, seen))];
}

function rssMb(pid) {
    try {
        const output = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return Math.round((Number(output) || 0) / 1024);
    } catch {
        return 0;
    }
}

const memoryTimer = setInterval(() => {
    const total = processTree(child.pid).reduce((sum, pid) => sum + rssMb(pid), 0);
    if (total < warnMb) {
        return;
    }
    const now = Date.now();
    if (now - lastMemoryWarning < 120000) {
        return;
    }
    lastMemoryWarning = now;
    console.warn(`[web] memory high: ${total} MB rss. Run "bun dev web mem trace" if it keeps climbing.`);
}, checkMs);
memoryTimer.unref?.();

child.on('exit', (code, signal) => {
    clearInterval(memoryTimer);
    process.exitCode = code ?? (signal ? 1 : 0);
});

child.on('error', (error) => {
    clearInterval(memoryTimer);
    console.error(error);
    process.exitCode = 1;
});
