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

const lockfile = resolve(import.meta.dirname, '../.bot.pid');

if (existsSync(lockfile)) {
    const old = Number(readFileSync(lockfile, 'utf-8').trim());
    try {
        process.kill(old, 0);
        console.error(`bot runtime already running (pid ${old})`);
        process.exit(1);
    } catch {
        // stale lockfile, process is dead
    }
}

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
