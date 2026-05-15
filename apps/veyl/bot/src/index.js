import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BotRuntime } from './runtime.js';

const originalError = console.error.bind(console);
console.error = (...args) => {
    const msg = args[0];
    if (typeof msg === 'string' && /^Connection error:.*retrying/i.test(msg)) {
        return;
    }
    originalError(...args);
};

const botDir = resolve(import.meta.dirname, '..');
const lockfile = resolve(botDir, '.bot.pid');

function sleep(ms) {
    return new Promise((resolveSleep) => {
        setTimeout(resolveSleep, ms);
    });
}

function isRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function processCwd(pid) {
    try {
        return execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .split('\n')
            .find((line) => line.startsWith('n'))
            ?.slice(1)
            .trim() || '';
    } catch {
        return '';
    }
}

function processCommand(pid) {
    try {
        return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return '';
    }
}

function pidFromLockfile() {
    if (!existsSync(lockfile)) {
        return null;
    }
    const pid = Number(readFileSync(lockfile, 'utf-8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function botRuntimePids() {
    let output;
    try {
        output = execFileSync('pgrep', ['-f', 'node .*src/index.js|node src/index.js'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return [];
    }

    return output
        .split('\n')
        .map((line) => Number(line.trim()))
        .filter((pid) => isRunning(pid))
        .filter((pid) => processCwd(pid) === botDir && /\bnode\b/.test(processCommand(pid)));
}

async function stopProcess(pid) {
    if (!isRunning(pid)) {
        return false;
    }

    try {
        process.kill(pid, 'SIGTERM');
    } catch {}

    for (let i = 0; i < 10; i += 1) {
        await sleep(100);
        if (!isRunning(pid)) {
            return true;
        }
    }

    try {
        process.kill(pid, 'SIGKILL');
    } catch {}

    for (let i = 0; i < 10; i += 1) {
        await sleep(100);
        if (!isRunning(pid)) {
            return true;
        }
    }

    return !isRunning(pid);
}

async function stopOtherRuntimes() {
    const pids = new Set([pidFromLockfile(), ...botRuntimePids()].filter((pid) => isRunning(pid)));
    if (!pids.size) {
        try {
            unlinkSync(lockfile);
        } catch {}
        return;
    }

    const stopped = [];
    const failed = [];

    for (const pid of pids) {
        if (await stopProcess(pid)) {
            stopped.push(pid);
        } else {
            failed.push(pid);
        }
    }

    if (stopped.length) {
        console.error(`stopped stale bot runtime${stopped.length === 1 ? '' : 's'}: ${stopped.join(', ')}`);
    }

    if (failed.length) {
        throw new Error(`failed to stop stale bot runtime${failed.length === 1 ? '' : 's'}: ${failed.join(', ')}`);
    }
}

await stopOtherRuntimes();

writeFileSync(lockfile, String(process.pid));

const runtime = new BotRuntime();

function stop() {
    try {
        unlinkSync(lockfile);
    } catch {}
    runtime.stop().catch((error) => {
        console.error('bot runtime shutdown failed', error);
        process.exitCode = 1;
    });
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);

await runtime.start();
