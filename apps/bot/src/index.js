import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BotRuntime } from './runtime.js';

const originalError = console.error.bind(console);
function isQuietConnectionNoise(msg) {
    if (typeof msg !== 'string') {
        return false;
    }
    if (/^Connection error:.*retrying/i.test(msg)) {
        return true;
    }
    return /Error in periodic token output optimization/i.test(msg)
        && /query_token_outputs/i.test(msg)
        && /(?:Transport error|socket connection was closed unexpectedly|Received HTTP 0 response|UNAVAILABLE)/i.test(msg);
}

console.error = (...args) => {
    if (isQuietConnectionNoise(args[0])) {
        return;
    }
    originalError(...args);
};

const botDir = resolve(import.meta.dirname, '..');
const lockdir = resolve(botDir, '.bot.lock');
const lockfile = resolve(lockdir, 'pid');
const REPLACE_EXISTING_RUNTIME = process.env.VEYL_REPLACE_BOT_RUNTIME === '1';
const REPLACE_TERM_WAIT_MS = 5000;
const REPLACE_KILL_WAIT_MS = 1000;
const REPLACE_POLL_MS = 100;

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

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitForExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isRunning(pid)) {
            return true;
        }
        await sleep(REPLACE_POLL_MS);
    }
    return !isRunning(pid);
}

async function terminatePid(pid) {
    if (!isRunning(pid)) {
        return;
    }

    try {
        process.kill(pid, 'SIGTERM');
    } catch {}

    if (await waitForExit(pid, REPLACE_TERM_WAIT_MS)) {
        return;
    }

    try {
        process.kill(pid, 'SIGKILL');
    } catch {}

    await waitForExit(pid, REPLACE_KILL_WAIT_MS);
}

async function replacePids(pids) {
    const targets = [...new Set(pids)].filter((pid) => isRunning(pid));
    if (!targets.length) {
        return;
    }

    await Promise.all(targets.map((pid) => terminatePid(pid)));

    const running = targets.filter((pid) => isRunning(pid));
    if (running.length) {
        throw new Error(`bot runtime replacement failed (pid${running.length === 1 ? '' : 's'} ${running.join(', ')})`);
    }
}

function removeLock() {
    try {
        rmSync(lockdir, { recursive: true, force: true });
    } catch {}
}

async function acquireLock() {
    try {
        mkdirSync(lockdir);
        writeFileSync(lockfile, String(process.pid));
    } catch (error) {
        if (error?.code !== 'EEXIST') {
            throw error;
        }

        const pid = readPid(lockfile);
        if (isRunning(pid)) {
            if (REPLACE_EXISTING_RUNTIME) {
                await replacePids([pid]);
            } else {
                throw new Error(`bot runtime already running (pid ${pid})`, { cause: error });
            }
        }

        removeLock();
        mkdirSync(lockdir);
        writeFileSync(lockfile, String(process.pid));
    }

    const pids = new Set(botRuntimePids());
    if (pids.size) {
        if (REPLACE_EXISTING_RUNTIME) {
            await replacePids(pids);
            removeLock();
            mkdirSync(lockdir);
            writeFileSync(lockfile, String(process.pid));
        } else {
            removeLock();
            throw new Error(`bot runtime already running (pid${pids.size === 1 ? '' : 's'} ${[...pids].join(', ')})`);
        }
    }

    const remainingPids = new Set(botRuntimePids());
    if (remainingPids.size) {
        removeLock();
        throw new Error(`bot runtime already running (pid${remainingPids.size === 1 ? '' : 's'} ${[...remainingPids].join(', ')})`);
    }
}

await acquireLock();

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
