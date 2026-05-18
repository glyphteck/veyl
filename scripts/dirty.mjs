import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ansi = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    red: '\x1b[31m',
};

function paint(text, color) {
    return process.env.NO_COLOR ? text : `${color}${text}${ansi.reset}`;
}

function run(cmd, args) {
    return new Promise((resolveRun, reject) => {
        const child = spawn(cmd, args, {
            cwd: rootDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolveRun(stdout);
                return;
            }
            reject(new Error(`${cmd} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `code ${code}`}: ${stderr.trim()}`));
        });
    });
}

function parseNumstat(output) {
    return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const [addedRaw, removedRaw, ...pathParts] = line.split('\t');
            const added = Number(addedRaw);
            const removed = Number(removedRaw);
            const binary = !Number.isFinite(added) || !Number.isFinite(removed);

            return {
                path: pathParts.join('\t'),
                added: binary ? null : added,
                removed: binary ? null : removed,
                binary,
                untracked: false,
            };
        });
}

function parseZ(output) {
    return output.split('\0').filter(Boolean);
}

function countTextLines(buffer) {
    if (buffer.includes(0)) {
        return null;
    }
    if (buffer.length === 0) {
        return 0;
    }

    let lines = 0;
    for (const byte of buffer) {
        if (byte === 10) {
            lines += 1;
        }
    }
    return buffer[buffer.length - 1] === 10 ? lines : lines + 1;
}

async function getUntrackedRows(paths) {
    const rows = [];

    for (const path of paths) {
        const buffer = await readFile(resolve(rootDir, path));
        const added = countTextLines(buffer);
        rows.push({
            path,
            added,
            removed: added == null ? null : 0,
            binary: added == null,
            untracked: true,
        });
    }

    return rows;
}

function pad(text, width) {
    return String(text).padStart(width);
}

function formatAdded(value, width) {
    const text = value == null ? 'bin' : `+${value}`;
    return paint(pad(text, width), value == null ? ansi.dim : ansi.green);
}

function formatRemoved(value, width) {
    const text = value == null ? 'bin' : `-${value}`;
    return paint(pad(text, width), value == null ? ansi.dim : ansi.red);
}

function printRows(rows) {
    const addedWidth = Math.max(5, ...rows.map((row) => (row.added == null ? 3 : String(row.added).length + 1)));
    const removedWidth = Math.max(5, ...rows.map((row) => (row.removed == null ? 3 : String(row.removed).length + 1)));

    process.stdout.write(`${paint(pad('add', addedWidth), ansi.green)}  ${paint(pad('del', removedWidth), ansi.red)}  file\n`);

    for (const row of rows) {
        const marker = row.untracked ? paint(' ??', ansi.dim) : '   ';
        process.stdout.write(`${formatAdded(row.added, addedWidth)}  ${formatRemoved(row.removed, removedWidth)}${marker}  ${row.path}\n`);
    }
}

async function main() {
    const [trackedRaw, untrackedRaw] = await Promise.all([
        run('git', ['diff', '--numstat', 'HEAD', '--']),
        run('git', ['ls-files', '--others', '--exclude-standard', '-z']),
    ]);
    const trackedRows = parseNumstat(trackedRaw);
    const untrackedRows = await getUntrackedRows(parseZ(untrackedRaw));
    const rows = [...trackedRows, ...untrackedRows].sort((a, b) => a.path.localeCompare(b.path));
    const totals = rows.reduce(
        (acc, row) => {
            if (row.binary) {
                acc.binary += 1;
                return acc;
            }
            acc.added += row.added;
            acc.removed += row.removed;
            return acc;
        },
        { added: 0, removed: 0, binary: 0 }
    );

    if (!rows.length) {
        process.stdout.write(`${paint('clean tree', ansi.green)}\n`);
        return;
    }

    const trackedCount = trackedRows.length;
    const untrackedCount = untrackedRows.length;
    const binaryNote = totals.binary ? paint(`, ${totals.binary} binary`, ansi.dim) : '';
    process.stdout.write(
        `${paint('dirty tree', ansi.red)}: ${paint(String(rows.length), ansi.bold)} file${rows.length === 1 ? '' : 's'} ` +
            `(${trackedCount} tracked, ${untrackedCount} untracked), ${paint(`+${totals.added}`, ansi.green)} ${paint(`-${totals.removed}`, ansi.red)}${binaryNote}\n\n`
    );
    printRows(rows);
}

main().catch((error) => {
    process.stderr.write(`${paint('dirty failed', ansi.red)}: ${error.message}\n`);
    process.exitCode = 1;
});
