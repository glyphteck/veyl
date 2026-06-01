#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredPathParts = ['/node_modules/', '/.next/', '/.expo/', '/ios/Pods/', '/ios/build/'];
const allowedHistoricalRefs = new Set(['CHANGELOG.md']);
const jsExts = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const relativeImportPattern = /(?:import|export)\s+(?:[^'"()]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

const forbiddenTrackedPaths = [
    { pattern: /^apps\/veyl\//, message: 'app workspaces now live directly under apps/web, apps/ios, and apps/bot' },
    { pattern: /^shared\/utils\.js$/, message: 'generic primitives live under shared/utils/*' },
    { pattern: /^shared\/localdatacache\.js$/, message: 'local cache helpers live under shared/cache/localdata.js' },
    { pattern: /^shared\/vaultutils\.js$/, message: 'vault helpers live under shared/vault.js' },
    { pattern: /^components\.json$/, message: 'shadcn config is intentionally absent' },
    { pattern: /^apps\/web\/src\/components\/ui\//, message: 'web UI primitives are Veyl-owned components, not shadcn scaffolding' },
];

const forbiddenTextRefs = [
    { pattern: /apps\/veyl\//, message: 'old app workspace path reference' },
    { pattern: /@glyphteck\/shared/, message: 'shared package is @veyl/shared' },
];

function runGit(args) {
    const result = spawnSync('git', args, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
}

function trackedFiles() {
    return runGit(['ls-files', '-z']).split('\0').filter(Boolean);
}

function untrackedFiles() {
    return runGit(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
}

function isIgnored(path) {
    return ignoredPathParts.some((part) => `/${path}`.includes(part));
}

function isText(buffer) {
    return !buffer.includes(0);
}

function fail(failures, path, detail) {
    failures.push(`${path}: ${detail}`);
}

function checkTrackedPaths(files, failures) {
    for (const path of files) {
        for (const rule of forbiddenTrackedPaths) {
            if (rule.pattern.test(path)) {
                fail(failures, path, rule.message);
            }
        }
    }
}

function checkTextRefs(files, failures) {
    for (const path of files) {
        if (allowedHistoricalRefs.has(path) || isIgnored(path)) {
            continue;
        }
        const abs = resolve(rootDir, path);
        if (!existsSync(abs)) {
            continue;
        }
        const buffer = readFileSync(abs);
        if (!isText(buffer)) {
            continue;
        }
        const text = buffer.toString('utf8');
        for (const rule of forbiddenTextRefs) {
            if (rule.pattern.test(text)) {
                fail(failures, path, rule.message);
            }
        }
    }
}

function stripSpecifier(value) {
    return String(value || '').split('?')[0].split('#')[0];
}

function resolveRelative(fromPath, specifier) {
    const base = resolve(rootDir, dirname(fromPath), stripSpecifier(specifier));
    const ext = extname(base);
    const candidates = ext
        ? [base]
        : [
              base,
              `${base}.js`,
              `${base}.jsx`,
              `${base}.mjs`,
              `${base}.cjs`,
              `${base}.json`,
              resolve(base, 'index.js'),
              resolve(base, 'index.jsx'),
              resolve(base, 'index.mjs'),
              resolve(base, 'index.cjs'),
          ];
    return candidates.some((candidate) => existsSync(candidate));
}

function checkRelativeImports(files, failures) {
    for (const path of files) {
        if (isIgnored(path) || !jsExts.has(extname(path))) {
            continue;
        }
        const abs = resolve(rootDir, path);
        if (!existsSync(abs)) {
            continue;
        }
        const text = readFileSync(abs, 'utf8');
        for (const match of text.matchAll(relativeImportPattern)) {
            const specifier = match[1] || match[2] || match[3] || '';
            if (!specifier.startsWith('.')) {
                continue;
            }
            if (!resolveRelative(path, specifier)) {
                fail(failures, path, `relative import does not resolve: ${specifier}`);
            }
        }
    }
}

const files = [...trackedFiles(), ...untrackedFiles()];
const failures = [];
checkTrackedPaths(files, failures);
checkTextRefs(files, failures);
checkRelativeImports(files, failures);

if (failures.length) {
    process.stderr.write(`path check failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}:\n`);
    for (const failure of failures) {
        process.stderr.write(`- ${failure}\n`);
    }
    process.exitCode = 1;
} else {
    process.stdout.write('path check passed\n');
}
