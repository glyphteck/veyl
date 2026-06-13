import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { uniqueValues } from '@veyl/shared/utils/array';
import { sleep } from '@veyl/shared/utils/async';
import { webApps } from '@veyl/shared/links';
import { lowerText } from '@veyl/shared/utils/text';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const verboseFlags = new Set(['-v', '--verbose']);
const verbose = args.some((arg) => verboseFlags.has(arg));
const filteredArgs = args.filter((arg) => !verboseFlags.has(arg));
const [rawTarget, ...rest] = filteredArgs;
const devFlags = new Set(['clear', 'tunnel', 'mainnet', 'regtest']);
const target = !rawTarget || devFlags.has(rawTarget) ? 'dev' : rawTarget;
const targetArgs = target === 'dev' ? filteredArgs : rest;
const ansi = {
    reset: '\x1b[0m',
    blue: '\x1b[38;5;117m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    pink: '\x1b[38;5;212m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
};

const commands = {
    web: ['bun', resolve(rootDir, 'scripts', 'web.mjs'), 'veyl'],
    ios: ['bun', resolve(rootDir, 'scripts', 'ios.mjs'), 'veyl'],
    bot: ['bun', '--cwd', resolve(rootDir, 'apps', 'bot'), 'src/index.js'],
};
const iosDir = resolve(rootDir, 'apps', 'ios');
const devPorts = ['3000', '8081'];
const tags = {
    ios: paint('[ios]', ansi.blue),
    web: paint('[web]', ansi.pink),
    bot: paint('[bot]', ansi.dim),
};
const lineState = new Map();
const readyUrls = new Map();
const lastConnectionLog = new Map();
const recentDiagnosticLines = new Map();
const runningBots = new Set();
const CONNECTION_LOG_COOLDOWN_MS = 60000;
const DIAGNOSTIC_LOG_COOLDOWN_MS = 60000;
const SLEEP_RESUME_IDLE_MS = 10 * 60 * 1000;
const SLEEP_RESUME_CONNECTION_QUIET_MS = 2 * 60 * 1000;
let lastRuntimeOutputAt = Date.now();
let resumeConnectionQuietUntil = 0;
let shuttingDown = false;

function paint(text, color) {
    return color ? `${color}${text}${ansi.reset}` : text;
}

function tag(name) {
    return tags[name] || paint(`[${name}]`, ansi.dim);
}

function timeTag() {
    return new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function explicit(name, line) {
    return `${tag(name)} ${paint(timeTag(), ansi.dim)} ${line}`;
}

function printStatus() {
    const webUrl = readyUrls.get('web');
    const iosUrl = readyUrls.get('ios');
    const bots = [...runningBots].sort();

    process.stdout.write(`${tag('web')} ${paint(webUrl ? `ready at ${webUrl}` : 'starting...', webUrl ? ansi.green : ansi.dim)}\n`);
    process.stdout.write(`${tag('ios')} ${paint(iosUrl ? `ready at ${iosUrl}` : 'starting...', iosUrl ? ansi.green : ansi.dim)}\n`);
    process.stdout.write(`${tag('bot')} ${paint(bots.length ? `running ${bots.map((username) => `@${username}`).join(', ')}` : 'starting...', bots.length ? ansi.green : ansi.dim)}\n`);
    process.stdout.write('\n');
}

function isWebRequest(line) {
    return line.match(/^\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\S+\s+(\d{3})\b/);
}

function getWebReadyUrl(line) {
    return line.match(/^- Local:\s+(https?:\/\/\S+)/)?.[1] || null;
}

function isIosReload(line) {
    return /^iOS Bundled\b/.test(line);
}

function isIosProgress(line) {
    return /^iOS .*[%)]$/.test(line);
}

function getIosReadyUrl(line) {
    const ready = line.trim().match(/^(?:›\s*)?(?:Metro )?waiting on (\S+)/i)?.[1] || null;
    return ready?.includes('://') ? ready : null;
}

function isWebReload(line) {
    return /Compiled in\b/.test(line);
}

function isWebStartupNoise(line) {
    return /^⚠ Self-signed certificates are currently an experimental feature/i.test(line)
        || /^\s+Using already generated self signed certificate$/i.test(line)
        || /^▲ Next\.js\b/.test(line)
        || /^- (Local|Network|Environments):/.test(line)
        || /^✓ Ready in\b/.test(line);
}

function isIosStartupNoise(line) {
    return /^env: /i.test(line)
        || /^Starting project at /i.test(line)
        || /^Expo Autolinking module resolution enabled$/i.test(line)
        || /^Starting Metro Bundler$/i.test(line)
        || /^Waiting on /i.test(line)
        || /^Logs for your project will appear below\.$/i.test(line)
        || /^\|?\s*\(node:\d+\) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set\./.test(line)
        || /^\|?\s*\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)/.test(line);
}

function isWarning(line) {
    return /^\s*Warning:/i.test(line)
        || /\bwarn(?:ing)?\b/i.test(line)
        || /changed size between renders/i.test(line);
}

function isError(line) {
    return /\b(?:ERROR|Error|ReferenceError|TypeError|SyntaxError|RangeError)\b/.test(line)
        || /\bFirebaseError\b/.test(line)
        || /\berrored\b/i.test(line);
}

function isBrowserSourceEcho(line) {
    return /^[A-Za-z]*Error: .+\((?:src|app|shared|functions)\//.test(line);
}

function isContinuation(line) {
    return /^\s*$/.test(line)
        || /^\s*at\b/.test(line)
        || /^for call at\b/.test(line)
        || /^Caused by:/i.test(line)
        || /^\s*\d+\s+\|/.test(line)
        || /^\s*[>|^]/.test(line)
        || /^\s*(Previous|Incoming):/.test(line)
        || /^\s*Set\.forEach\b/.test(line)
        || /^\s*\([^)]*:\d+:\d+\)\s*$/.test(line);
}

function getConnectionLossSource(line) {
    if (line.includes('WebChannelConnection RPC') && line.includes('transport errored')) {
        return 'backend';
    }
    if (
        line.includes('Error in periodic token output optimization')
        && line.includes('query_token_outputs')
        && /(?:Transport error|socket connection was closed unexpectedly|Received HTTP 0 response|UNAVAILABLE|UNKNOWN)/i.test(line)
    ) {
        return 'wallet';
    }
    if (line.includes('bot runtime heartbeat lost connection')) {
        return 'backend';
    }
    if (line.includes('bot runtime heartbeat failed') && /\b(?:DEADLINE_EXCEEDED|UNAVAILABLE)\b/.test(line)) {
        return 'backend';
    }
    if (line.includes('bot runtime subscription failed') && /\b(?:DEADLINE_EXCEEDED|UNAVAILABLE)\b/.test(line)) {
        return 'backend';
    }
    if (line.includes('subscription failed') && line.includes('A backoff operation is already in progress.')) {
        return 'backend';
    }
    if (line.includes('Connection error:') && line.includes('/spark_') && line.includes('UNAVAILABLE:')) {
        return 'wallet';
    }
    return null;
}

function shouldSkipConnectionLog(name, source, now = Date.now()) {
    const key = `${name}:${source}`;
    const last = lastConnectionLog.get(key) || 0;
    if (now - last < CONNECTION_LOG_COOLDOWN_MS) {
        return true;
    }
    lastConnectionLog.set(key, now);
    return false;
}

function shouldSkipResumeConnectionLog(idleMs, now) {
    if (idleMs > SLEEP_RESUME_IDLE_MS) {
        resumeConnectionQuietUntil = now + SLEEP_RESUME_CONNECTION_QUIET_MS;
        return true;
    }
    return now < resumeConnectionQuietUntil;
}

function diagnosticDedupeKey(name, line) {
    if (name !== 'web') {
        return null;
    }

    const trimmed = line.trim();
    const isNextExportDiagnostic = /^\[browser\]\s+\.\//.test(trimmed)
        || /^Export .+ doesn't exist in target module$/.test(trimmed)
        || /^The export .+ was not found in module /.test(trimmed)
        || /^Did you mean to import /.test(trimmed)
        || /^All exports of the module are statically known/.test(trimmed)
        || /^Import traces:$/.test(trimmed)
        || /^Client Component (?:Browser|SSR):$/.test(trimmed)
        || /^\.\/(?:app|apps|src|shared|functions)\//.test(trimmed);

    if (!isNextExportDiagnostic) {
        return null;
    }

    const normalized = trimmed
        .replace(/\s+/g, ' ')
        .replace(/\[(?:app-client|app-ssr)\]/g, '[app]')
        .replace(/\[Client Component (?:Browser|SSR)\]/g, '[Client Component]')
        .replace(/\bClient Component (?:Browser|SSR):/g, 'Client Component:');

    return `${name}:${normalized}`;
}

function shouldSkipDiagnosticLine(name, line) {
    const key = diagnosticDedupeKey(name, line);
    if (!key) {
        return false;
    }

    const now = Date.now();
    const last = recentDiagnosticLines.get(key) || 0;
    if (now - last < DIAGNOSTIC_LOG_COOLDOWN_MS) {
        return true;
    }
    recentDiagnosticLines.set(key, now);
    return false;
}

function format(name, rawLine) {
    const line = rawLine.replace(/\r/g, '');
    const now = Date.now();
    const idleMs = now - lastRuntimeOutputAt;
    lastRuntimeOutputAt = now;

    if (shuttingDown) {
        return null;
    }

    if (verbose) {
        return `${tag(name)} ${line}`;
    }

    const webReadyUrl = name === 'web' ? getWebReadyUrl(line) : null;
    const iosReadyUrl = name === 'ios' ? getIosReadyUrl(line) : null;
    const botReady = name === 'bot' ? lowerText(line.match(/^bot @([a-z0-9]+) ready\b/i)?.[1]) : null;
    const botClosed = name === 'bot' ? lowerText(line.match(/^bot @([a-z0-9]+) (?:disabled|failed)\b/i)?.[1]) : null;

    if (webReadyUrl) {
        readyUrls.set('web', webReadyUrl);
        return null;
    }

    if (iosReadyUrl) {
        readyUrls.set('ios', iosReadyUrl);
        return explicit(name, paint(`ready at ${iosReadyUrl}`, ansi.green));
    }

    if (botReady) {
        runningBots.add(botReady);
        return null;
    }

    if (botClosed) {
        runningBots.delete(botClosed);
        return explicit(name, paint(`@${botClosed} stopped`, ansi.yellow));
    }

    if (name === 'web' && /^✓ Ready in\b/.test(line)) {
        const url = readyUrls.get('web') || webApps.veyl.origin;
        lineState.delete(name);
        return explicit(name, paint(`ready at ${url}`, ansi.green));
    }

    if (name === 'ios' && isIosProgress(line)) {
        lineState.delete(name);
        return null;
    }

    if (name === 'ios' && isIosReload(line)) {
        lineState.delete(name);
        return explicit(name, paint('reload', ansi.green));
    }

    if (name === 'web' && isWebReload(line)) {
        lineState.delete(name);
        return explicit(name, paint('reload', ansi.green));
    }

    if (name === 'web' && isWebStartupNoise(line)) {
        return null;
    }

    if (name === 'ios' && isIosStartupNoise(line)) {
        return null;
    }

    if (name === 'bot' && /^bot runtime started\b/.test(line)) {
        lineState.delete(name);
        return explicit(name, paint(line, ansi.green));
    }

    if (name === 'web') {
        const match = isWebRequest(line);
        if (match) {
            lineState.delete(name);
            const status = Number(match[2]);
            if (status < 400) {
                return null;
            }
            return explicit(name, paint(line, ansi.red));
        }
    }

    const connectionSource = getConnectionLossSource(line);
    if (connectionSource) {
        lineState.set(name, 'connection');
        if (
            shouldSkipResumeConnectionLog(idleMs, now)
            || shouldSkipConnectionLog(name, connectionSource, now)
        ) {
            return null;
        }
        return explicit(name, paint(`[${connectionSource}] lost connection`, ansi.yellow));
    }

    if (shouldSkipDiagnosticLine(name, line)) {
        return null;
    }

    if (lineState.get(name) === 'error' && isBrowserSourceEcho(line)) {
        return null;
    }

    if (isError(line)) {
        lineState.set(name, 'error');
        return explicit(name, paint(line, ansi.red));
    }

    if (isWarning(line)) {
        lineState.set(name, 'warning');
        return explicit(name, paint(line, ansi.yellow));
    }

    if (isContinuation(line)) {
        const state = lineState.get(name);
        if (state === 'connection') {
            return null;
        }
        if (state === 'error') {
            return line ? explicit(name, paint(line, ansi.red)) : null;
        }
        if (state === 'warning') {
            return line ? explicit(name, paint(line, ansi.yellow)) : null;
        }
        return null;
    }

    lineState.delete(name);
    return null;
}

function pipe(name, stream, target) {
    if (!stream) {
        return;
    }
    const rl = createInterface({ input: stream });
    rl.on('line', (line) => {
        const formatted = format(name, line);
        if (!formatted) {
            return;
        }
        target.write(`${formatted}\n`);
    });
}

function run(command, commandArgs, options = {}) {
    return spawn(command, commandArgs, {
        cwd: options.cwd || rootDir,
        env: options.env || process.env,
        stdio: options.stdio || 'inherit',
    });
}

function hasFlag(args, flag) {
    return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function stop(child, signal = 'SIGTERM') {
    if (!child || child.killed) {
        return;
    }
    try {
        child.kill(signal);
    } catch {}
}

function getPortPids(port) {
    try {
        const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (!output) {
            return [];
        }
        return uniqueValues(output
            .split('\n')
            .slice(1)
            .map((line) => line.trim().split(/\s+/)[1]));
    } catch {
        return [];
    }
}

function killPort(port) {
    const pids = getPortPids(port);
    for (const pid of pids) {
        try {
            process.kill(Number(pid), 'SIGKILL');
        } catch {}
    }
}

async function clearPorts(ports) {
    for (const port of ports) {
        killPort(port);
    }

    for (let i = 0; i < 20; i += 1) {
        const busy = ports.filter((port) => getPortPids(port).length);
        if (!busy.length) {
            return;
        }
        await sleep(100);
        for (const port of busy) {
            killPort(port);
        }
    }
}

async function runDev() {
    const children = new Map();
    let closing = false;
    let clearInputAttached = false;
    const childEnv = { ...process.env, ...(verbose ? { VEYL_VERBOSE: '1' } : {}) };
    const webArgs = targetArgs.filter((arg) => ['clear', 'mainnet', 'regtest', 'inspect', 'mem', 'trace'].includes(arg));
    const iosArgs = targetArgs.filter((arg) => ['clear', 'tunnel', 'mainnet', 'regtest'].includes(arg));
    if (targetArgs.includes('mainnet')) {
        childEnv.NETWORK = 'MAINNET';
    } else if (targetArgs.includes('regtest')) {
        childEnv.NETWORK = 'REGTEST';
    }

    await clearPorts(devPorts);

    const spawnRuntime = (name, command, ...commandArgs) => {
        const env = name === 'bot'
            ? { ...childEnv, VEYL_REPLACE_BOT_RUNTIME: '1' }
            : childEnv;
        const child = run(command, commandArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        children.set(name, child);
        pipe(name, child.stdout, process.stdout);
        pipe(name, child.stderr, process.stderr);
        child.on('exit', (code, signal) => {
            children.delete(name);
            if (closing) {
                return;
            }
            closing = true;
            for (const [, current] of children) {
                stop(current);
            }
            process.exitCode = code ?? (signal ? 1 : 0);
        });
        child.on('error', (error) => {
            console.error(explicit(name, paint(error?.message || String(error), ansi.red)));
            if (closing) {
                return;
            }
            closing = true;
            for (const [, current] of children) {
                stop(current);
            }
            process.exitCode = 1;
        });
        return child;
    };

    spawnRuntime('web', ...commands.web, ...webArgs);
    spawnRuntime('ios', ...commands.ios, ...iosArgs);
    spawnRuntime('bot', ...commands.bot);
    printStatus();

    const shutdown = () => {
        if (closing) {
            return;
        }
        closing = true;
        shuttingDown = true;
        process.stdout.write('shutting down\n');
        for (const [, child] of children) {
            stop(child);
        }
        setTimeout(() => {
            for (const [, child] of children) {
                stop(child, 'SIGKILL');
            }
        }, 3000).unref?.();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', shutdown);

    if (process.stdin.isTTY) {
        emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const onKeypress = (str, key = {}) => {
            if ((key.ctrl && key.name === 'c') || key.sequence === '\u0003') {
                shutdown();
                return;
            }
            if (!key.ctrl && !key.meta && !key.shift && str === 'c') {
                process.stdout.write('\x1bc');
                printStatus();
            }
        };

        process.stdin.on('keypress', onKeypress);
        clearInputAttached = true;

        const resetInput = () => {
            if (!clearInputAttached || !process.stdin.isTTY) {
                return;
            }
            clearInputAttached = false;
            process.stdin.off('keypress', onKeypress);
            process.stdin.setRawMode(false);
            process.stdin.pause();
        };

        process.on('exit', resetInput);
    }

    await new Promise((resolve) => {
        const checkDone = () => {
            if (children.size === 0) {
                resolve();
            }
        };
        for (const [, child] of children) {
            child.on('exit', checkDone);
        }
    });

    await clearPorts(devPorts);
}

if (target === 'dev') {
    await runDev();
    process.exit(process.exitCode ?? 0);
}

if (!commands[target]) {
    console.error('Usage: bun dev [-v|--verbose] [web|ios|bot] [...args]');
    process.exit(1);
}

let cwd = rootDir;
let commandLine = [...commands[target], ...rest];

if (target === 'ios' && rest[0] === 'submit') {
    const submitArgs = rest.slice(1);
    const hasBuildSource = hasFlag(submitArgs, '--latest') || hasFlag(submitArgs, '--id') || hasFlag(submitArgs, '--path') || hasFlag(submitArgs, '--url');
    commandLine = [
        'bun',
        'x',
        'eas-cli',
        'submit',
        '--platform',
        'ios',
        '--profile',
        'prod',
        ...(hasBuildSource ? [] : ['--latest']),
        ...submitArgs,
    ];
    cwd = iosDir;
}

const [command, ...commandArgs] = commandLine;
const env = {
    ...process.env,
    ...(verbose ? { VEYL_VERBOSE: '1' } : {}),
    ...(target === 'bot' ? { VEYL_REPLACE_BOT_RUNTIME: '1' } : {}),
};
const shouldFilterOutput = !verbose && !(target === 'ios' && rest[0] === 'submit');
const child = run(command, commandArgs, {
    cwd,
    env,
    stdio: shouldFilterOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
});

if (shouldFilterOutput) {
    pipe(target, child.stdout, process.stdout);
    pipe(target, child.stderr, process.stderr);
}

child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
});

child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
});
