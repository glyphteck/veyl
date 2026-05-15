import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearLine, createInterface, cursorTo, emitKeypressEvents, moveCursor } from 'node:readline';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = resolve(rootDir, 'package.json');
const [command, ...rawArgs] = process.argv.slice(2);
const versionChoices = [
    { label: 'patch', value: 'patch', description: 'bugfix or small change' },
    { label: 'minor', value: 'minor', description: 'new feature' },
    { label: 'major', value: 'major', description: 'breaking change' },
];
const ansi = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    red: '\x1b[31m',
};

function paint(text, color) {
    return color ? `${color}${text}${ansi.reset}` : text;
}

function usage() {
    process.stdout.write(`Usage:
  pnpm push [patch|minor|major] [commit message]
  pnpm merge <pr> [patch|minor|major] [commit message]

Options:
  -v, --version <patch|minor|major>
  -m, --message <message>
  -p, --pr <number>

Examples:
  pnpm push
  pnpm push --version patch --message "update"
  pnpm merge --pr 123
`);
}

function parseArgs(args) {
    const flags = {};
    const positionals = [];

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];

        if (arg === '--') {
            positionals.push(...args.slice(i + 1));
            break;
        }
        if (arg === '-h' || arg === '--help') {
            flags.help = true;
            continue;
        }
        if (arg === '-y' || arg === '--yes') {
            flags.yes = true;
            continue;
        }
        if (arg === '-v' || arg === '--version') {
            flags.version = args[i + 1];
            i += 1;
            continue;
        }
        if (arg.startsWith('--version=')) {
            flags.version = arg.slice('--version='.length);
            continue;
        }
        if (arg === '-m' || arg === '--message') {
            flags.message = args[i + 1];
            i += 1;
            continue;
        }
        if (arg.startsWith('--message=')) {
            flags.message = arg.slice('--message='.length);
            continue;
        }
        if (arg === '-p' || arg === '--pr') {
            flags.pr = args[i + 1];
            i += 1;
            continue;
        }
        if (arg.startsWith('--pr=')) {
            flags.pr = arg.slice('--pr='.length);
            continue;
        }

        positionals.push(arg);
    }

    return { flags, positionals };
}

function isVersion(value) {
    return versionChoices.some((choice) => choice.value === value);
}

function normalizeVersion(value) {
    if (!value) return null;
    const next = value.trim().toLowerCase();
    if (!isVersion(next)) {
        throw new Error(`version must be one of: ${versionChoices.map((choice) => choice.value).join(', ')}`);
    }
    return next;
}

function normalizePr(value) {
    const next = String(value || '').trim().replace(/^#/, '');
    if (!/^\d+$/.test(next)) {
        throw new Error('PR number is required');
    }
    return next;
}

function quoteArg(arg) {
    if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) {
        return arg;
    }
    return JSON.stringify(arg);
}

function commandLine([cmd, args]) {
    return [cmd, ...args].map(quoteArg).join(' ');
}

function clearRendered(lines) {
    if (!lines || !process.stdout.isTTY) return;
    for (let i = 0; i < lines; i += 1) {
        moveCursor(process.stdout, 0, -1);
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
    }
}

function renderChoice(choice, active) {
    const marker = active ? paint('›', ansi.green) : ' ';
    const label = active ? paint(choice.label, ansi.bold) : choice.label;
    const description = choice.description ? paint(`  ${choice.description}`, ansi.dim) : '';
    return `  ${marker} ${label}${description}`;
}

async function select(label, choices, defaultValue) {
    const defaultIndex = Math.max(0, choices.findIndex((choice) => choice.value === defaultValue));

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return choices[defaultIndex]?.value ?? choices[0]?.value;
    }

    let selected = defaultIndex;
    let rendered = 0;
    const wasRaw = process.stdin.isRaw;

    return new Promise((resolve, reject) => {
        const render = () => {
            clearRendered(rendered);
            const lines = [
                `${paint('?', ansi.bold)} ${label}`,
                ...choices.map((choice, index) => renderChoice(choice, index === selected)),
            ];
            for (const line of lines) {
                process.stdout.write(`${line}\n`);
            }
            rendered = lines.length;
        };

        const done = (value, error) => {
            process.stdin.off('keypress', onKeypress);
            if (!wasRaw) {
                process.stdin.setRawMode(false);
            }
            process.stdin.pause();
            clearRendered(rendered);
            rendered = 0;

            if (error) {
                reject(error);
                return;
            }

            const choice = choices.find((item) => item.value === value);
            process.stdout.write(`${paint('?', ansi.bold)} ${label}: ${choice?.label || value}\n`);
            resolve(value);
        };

        const onKeypress = (str, key = {}) => {
            if ((key.ctrl && key.name === 'c') || key.sequence === '\u0003') {
                done(null, new Error('cancelled'));
                return;
            }
            if (key.name === 'up' || str === 'k') {
                selected = (selected + choices.length - 1) % choices.length;
                render();
                return;
            }
            if (key.name === 'down' || str === 'j') {
                selected = (selected + 1) % choices.length;
                render();
                return;
            }
            if (key.name === 'return' || key.name === 'enter' || str === '\r' || str === '\n') {
                done(choices[selected].value);
            }
        };

        emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('keypress', onKeypress);
        render();
    });
}

async function askText(label, defaultValue = '', { required = false } = {}) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        if (required && !defaultValue) {
            throw new Error(`${label} is required`);
        }
        return defaultValue;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    process.stdin.resume();
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    const answer = await new Promise((resolve) => {
        rl.question(`${label}${suffix}: `, resolve);
    });
    rl.close();
    process.stdin.pause();

    const value = String(answer || '').trim() || defaultValue;
    if (required && !value) {
        process.stdout.write(`${paint('!', ansi.red)} ${label} is required\n`);
        return askText(label, defaultValue, { required });
    }
    return value;
}

async function run(cmd, args) {
    return new Promise((resolveRun, reject) => {
        const child = spawn(cmd, args, {
            cwd: rootDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });
        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk;
        });

        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolveRun({ stdout, stderr });
                return;
            }

            const output = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
            const detail = output ? `\n${output}` : '';
            reject(new Error(`${commandLine([cmd, args])} failed with ${signal ? `signal ${signal}` : `code ${code}`}${detail}`));
        });

        child.on('error', reject);
    });
}

async function bumpVersion(release) {
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
    const parts = String(pkg.version || '').split('.').map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
        throw new Error(`unsupported package version: ${pkg.version}`);
    }

    if (release === 'major') {
        parts[0] += 1;
        parts[1] = 0;
        parts[2] = 0;
    } else if (release === 'minor') {
        parts[1] += 1;
        parts[2] = 0;
    } else {
        parts[2] += 1;
    }

    pkg.version = parts.join('.');
    await writeFile(packagePath, `${JSON.stringify(pkg, null, 4)}\n`);
    return pkg.version;
}

function workflowCommands(action, { version, message, pr }) {
    const release = [
        ['version', [version]],
        ['git', ['add', '-A']],
        ['git', ['commit', '-m', message]],
        ['git', ['push', 'origin', 'HEAD:main', '+HEAD:regtest']],
    ];

    if (action === 'push') {
        return release;
    }

    return [
        ['git', ['switch', 'main']],
        ['git', ['pull', '--ff-only']],
        ['gh', ['pr', 'checkout', pr]],
        ['git', ['switch', 'main']],
        ['git', ['merge', '--no-ff', '-m', `merge pr #${pr}`, 'FETCH_HEAD']],
        ...release,
    ];
}

async function resolveVersion(parsed) {
    const version = normalizeVersion(parsed.flags.version || (isVersion(parsed.positionals[0]) ? parsed.positionals.shift() : null));
    return version || select('Version bump', versionChoices, 'patch');
}

async function resolveMessage(parsed) {
    const positionalMessage = parsed.positionals.join(' ').trim();
    return parsed.flags.message?.trim() || positionalMessage || askText('Commit message', 'update');
}

async function resolvePush(parsed) {
    const version = await resolveVersion(parsed);
    const message = await resolveMessage(parsed);
    return { version, message };
}

async function resolveMerge(parsed) {
    let pr = parsed.flags.pr;

    if (!pr && parsed.positionals[0] && !isVersion(parsed.positionals[0])) {
        pr = parsed.positionals.shift();
    }
    if (!pr) {
        pr = await askText('PR number', '', { required: true });
    }

    const version = await resolveVersion(parsed);
    const message = await resolveMessage(parsed);
    return { pr: normalizePr(pr), version, message };
}

async function runStep(cmd, args) {
    if (cmd === 'version') {
        const version = await bumpVersion(args[0]);
        return { version };
    }
    return run(cmd, args);
}

async function commitId() {
    const { stdout } = await run('git', ['rev-parse', '--short=12', 'HEAD']);
    return stdout.trim();
}

async function runWorkflow(action, config) {
    const commands = workflowCommands(action, config);

    for (const item of commands) {
        await runStep(...item);
    }

    const hash = await commitId();
    process.stdout.write(`${paint(action === 'merge' ? 'Merge pushed' : 'Push succeeded', ansi.green)} ${hash}\n`);
}

async function main() {
    if (!command || command === '-h' || command === '--help' || command === 'help') {
        usage();
        return;
    }

    const parsed = parseArgs(rawArgs);
    if (parsed.flags.help) {
        usage();
        return;
    }

    if (command === 'push') {
        await runWorkflow('push', await resolvePush(parsed));
        return;
    }

    if (command === 'merge') {
        await runWorkflow('merge', await resolveMerge(parsed));
        return;
    }

    throw new Error(`unknown command: ${command}`);
}

await main().catch((error) => {
    const message = error?.message || String(error);
    process.stderr.write(`${paint('error', ansi.red)} ${message}\n`);
    process.exitCode = message === 'cancelled' ? 130 : 1;
});
