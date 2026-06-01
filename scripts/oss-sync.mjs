import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OSS_DEFAULT_REPO_DIR, ossAllowlist, ossExcludedByPolicy } from './oss-allowlist.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ansi = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    red: '\x1b[31m',
};

function paint(text, color) {
    return color ? `${color}${text}${ansi.reset}` : text;
}

function parseArgs(raw) {
    const flags = { push: false, dryRun: false, force: false, message: '' };
    for (let i = 0; i < raw.length; i += 1) {
        const arg = raw[i];
        if (arg === '--push') {
            flags.push = true;
            continue;
        }
        if (arg === '--dry-run') {
            flags.dryRun = true;
            continue;
        }
        if (arg === '--force') {
            flags.force = true;
            continue;
        }
        if (arg === '-m' || arg === '--message') {
            flags.message = raw[i + 1] || '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--message=')) {
            flags.message = arg.slice('--message='.length);
            continue;
        }
        throw new Error(`unknown oss sync argument: ${arg}`);
    }
    return flags;
}

function ossRepoDir() {
    return resolve(rootDir, process.env.VEYL_OSS_REPO || OSS_DEFAULT_REPO_DIR);
}

function ensureRelativePath(path) {
    if (!path || path.startsWith('/') || path.includes('..')) {
        throw new Error(`invalid oss allowlist path: ${path}`);
    }
}

function normalizeEntry(entry) {
    const from = typeof entry === 'string' ? entry : entry?.from;
    const to = typeof entry === 'string' ? entry : entry?.to;
    ensureRelativePath(from);
    ensureRelativePath(to || from);
    return { from, to: to || from };
}

function runGit(cwd, gitArgs, { allowFailure = false } = {}) {
    return new Promise((resolveRun, reject) => {
        const child = spawn('git', gitArgs, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('exit', (code) => {
            if (code === 0 || allowFailure) {
                resolveRun({ code, stdout, stderr });
                return;
            }
            reject(new Error(`git ${gitArgs.join(' ')} failed in ${cwd}\n${stderr || stdout}`.trim()));
        });
        child.on('error', reject);
    });
}

async function assertOssRepoReady(targetDir, { force = false } = {}) {
    if (basename(targetDir) !== 'veyl-oss' && !process.env.VEYL_OSS_REPO) {
        throw new Error(`refusing to sync to ${targetDir}; expected a veyl-oss checkout or VEYL_OSS_REPO`);
    }
    if (!existsSync(resolve(targetDir, '.git'))) {
        throw new Error(`oss repo checkout not found at ${targetDir}`);
    }
    const { stdout } = await runGit(targetDir, ['status', '--short']);
    if (stdout.trim() && !force) {
        throw new Error(`oss repo has local changes at ${targetDir}; commit, discard, or rerun with --force`);
    }
}

async function emptyTarget(targetDir) {
    const entries = await readdir(targetDir, { withFileTypes: true });
    await Promise.all(entries
        .filter((entry) => entry.name !== '.git')
        .map((entry) => rm(resolve(targetDir, entry.name), { recursive: true, force: true })));
}

async function copyEntry(targetDir, entry) {
    const source = resolve(rootDir, entry.from);
    const destination = resolve(targetDir, entry.to);
    const info = await stat(source).catch(() => null);
    if (!info) {
        throw new Error(`oss allowlist source missing: ${entry.from}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, {
        recursive: info.isDirectory(),
        force: true,
        errorOnExist: false,
        dereference: false,
    });
}

async function assertAllowlistSources(entries) {
    for (const entry of entries) {
        const source = resolve(rootDir, entry.from);
        const info = await stat(source).catch(() => null);
        if (!info) {
            throw new Error(`oss allowlist source missing: ${entry.from}`);
        }
    }
}

async function commitAndMaybePush(targetDir, { message, push }) {
    await runGit(targetDir, ['add', '-A']);
    const { stdout } = await runGit(targetDir, ['status', '--short']);
    if (!stdout.trim()) {
        process.stdout.write(`${paint('OSS sync unchanged', ansi.green)} ${targetDir}\n`);
        return;
    }
    await runGit(targetDir, ['commit', '-m', message || 'sync veyl client source']);
    if (push) {
        await runGit(targetDir, ['push']);
    }
    process.stdout.write(`${paint(push ? 'OSS sync pushed' : 'OSS sync committed', ansi.green)} ${targetDir}\n`);
}

export async function syncOssRepo({ message = '', push = false, dryRun = false, force = false, preflight = false } = {}) {
    const targetDir = ossRepoDir();
    const entries = ossAllowlist.map(normalizeEntry);
    if (dryRun) {
        process.stdout.write(`OSS target: ${targetDir}\n`);
        process.stdout.write('Included paths:\n');
        entries.forEach((entry) => {
            const target = entry.to === entry.from ? entry.from : `${entry.from} -> ${entry.to}`;
            process.stdout.write(`  ${target}\n`);
        });
        process.stdout.write(`${paint('Excluded by policy:', ansi.dim)}\n`);
        ossExcludedByPolicy.forEach((path) => process.stdout.write(`  ${path}\n`));
        return;
    }

    if (preflight) {
        await assertOssRepoReady(targetDir, { force });
        await assertAllowlistSources(entries);
        return;
    }

    await assertOssRepoReady(targetDir, { force });
    await assertAllowlistSources(entries);
    await emptyTarget(targetDir);
    for (const entry of entries) {
        await copyEntry(targetDir, entry);
    }
    await commitAndMaybePush(targetDir, { message, push });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    syncOssRepo(parseArgs(args)).catch((error) => {
        process.stderr.write(`${paint('error', ansi.red)} ${error?.message || String(error)}\n`);
        process.exitCode = 1;
    });
}
