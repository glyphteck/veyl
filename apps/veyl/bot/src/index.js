import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
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
const lockdir = resolve(botDir, '.bot.lock');
const lockfile = resolve(lockdir, 'pid');

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

function readPid(file) {
    if (!existsSync(file)) {
        return null;
    }
    const pid = Number(readFileSync(file, 'utf-8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function botRuntimePids() {
    let output;
    try {
        output = execFileSync('pgrep', ['-f', 'bun .*src/index.js|bun src/index.js'], {
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
        .filter((pid) => processCwd(pid) === botDir && /\bbun\b/.test(processCommand(pid)));
}

function removeLock() {
    try {
        rmSync(lockdir, { recursive: true, force: true });
    } catch {}
}

function acquireLock() {
    try {
        mkdirSync(lockdir);
        writeFileSync(lockfile, String(process.pid));
    } catch (error) {
        if (error?.code !== 'EEXIST') {
            throw error;
        }

        const pid = readPid(lockfile);
        if (isRunning(pid)) {
            throw new Error(`bot runtime already running (pid ${pid})`, { cause: error });
        }

        removeLock();
        mkdirSync(lockdir);
        writeFileSync(lockfile, String(process.pid));
    }

    const pids = new Set(botRuntimePids());
    if (pids.size) {
        removeLock();
        throw new Error(`bot runtime already running (pid${pids.size === 1 ? '' : 's'} ${[...pids].join(', ')})`);
    }
}

acquireLock();

const runtime = new BotRuntime();
let stopping = false;

function stop() {
    if (stopping) {
        return;
    }
    stopping = true;
    runtime.stop().catch((error) => {
        console.error('bot runtime shutdown failed', error);
        process.exitCode = 1;
    });
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);

try {
    await runtime.start();
} finally {
    removeLock();
}
