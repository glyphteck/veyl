#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(args) {
    const result = spawnSync(args[0], args.slice(1), {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.status === 0 ? result.stdout.trim() : '';
}

function readJson(path) {
    return JSON.parse(readFileSync(resolve(rootDir, path), 'utf8'));
}

function section(title) {
    process.stdout.write(`\n## ${title}\n`);
}

function bullet(label, value) {
    process.stdout.write(`- ${label}: ${value || 'none'}\n`);
}

function statusSummary() {
    const branch = run(['git', 'branch', '--show-current']) || 'detached';
    const head = run(['git', 'rev-parse', '--short=12', 'HEAD']);
    const status = run(['git', 'status', '--short']);
    const files = status ? status.split('\n').filter(Boolean) : [];

    bullet('branch', branch);
    bullet('head', head);
    bullet('dirty files', files.length ? String(files.length) : 'clean');
    if (files.length) {
        for (const line of files.slice(0, 20)) {
            process.stdout.write(`  ${line}\n`);
        }
        if (files.length > 20) {
            process.stdout.write(`  ... ${files.length - 20} more\n`);
        }
    }
}

function workspaceSummary() {
    const rootPkg = readJson('package.json');
    const packages = rootPkg.workspaces?.packages || [];
    bullet('workspace globs', packages.join(', '));

    for (const dir of ['apps/web', 'apps/ios', 'apps/bot', 'shared']) {
        const pkgPath = `${dir}/package.json`;
        if (!existsSync(resolve(rootDir, pkgPath))) {
            continue;
        }
        const pkg = readJson(pkgPath);
        bullet(pkg.name || dir, dir);
    }

    const projectPath = resolve(rootDir, '.vercel/project.json');
    if (existsSync(projectPath)) {
        const project = JSON.parse(readFileSync(projectPath, 'utf8'));
        bullet('vercel project', `${project.projectName} (${project.projectId})`);
    }
}

function todoSummary() {
    const todoDir = resolve(rootDir, 'todo');
    if (!existsSync(todoDir)) {
        bullet('active todos', 'none');
        return;
    }
    const todos = readdirSync(todoDir)
        .filter((name) => name.endsWith('.md'))
        .sort();
    bullet('active todos', todos.length ? String(todos.length) : 'none');
    for (const name of todos) {
        process.stdout.write(`  todo/${name}\n`);
    }
}

function cleanCell(cell) {
    return cell.trim().replace(/`/g, '');
}

function featureRowsFromGuide() {
    const guide = readFileSync(resolve(rootDir, 'guidelines/map.md'), 'utf8');
    const rows = [];
    let inTable = false;

    for (const line of guide.split('\n')) {
        if (line.startsWith('| System |')) {
            inTable = true;
            continue;
        }
        if (!inTable) {
            continue;
        }
        if (!line.startsWith('|')) {
            break;
        }
        if (line.startsWith('| ---')) {
            continue;
        }
        const cells = line.slice(1, -1).split('|').map(cleanCell);
        if (cells.length >= 4) {
            rows.push({
                name: cells[0],
                start: cells[1],
                related: cells[2],
                docs: cells[3],
            });
        }
    }

    return rows;
}

function printFeatureRows() {
    for (const row of featureRowsFromGuide()) {
        process.stdout.write(`\n- ${row.name}\n`);
        process.stdout.write(`  start: ${row.start}\n`);
        process.stdout.write(`  related: ${row.related}\n`);
        process.stdout.write(`  docs: ${row.docs}\n`);
    }
}

function printFastCommands() {
    process.stdout.write('- bun dirty\n');
    process.stdout.write('- bun check:paths\n');
    process.stdout.write('- bun --filter @glyphteck/veyl-web lint\n');
    process.stdout.write('- bun --filter @glyphteck/veyl-ios lint\n');
    process.stdout.write('- bun --filter @glyphteck/veyl-bot lint\n');
    process.stdout.write('- bun --filter @veyl/shared lint\n');
    process.stdout.write('- cd functions && npm run lint\n');
}

process.stdout.write('# Veyl Agent Map\n');
process.stdout.write('Read order: AGENTS.md -> README.md -> guidelines/map.md -> focused guideline files.\n');

section('Live State');
statusSummary();

section('Packages');
workspaceSummary();

section('Active Work');
todoSummary();

section('Feature Starts');
printFeatureRows();

section('Fast Commands');
printFastCommands();

section('Tracking Rule');
process.stdout.write('- Use git status and bun dirty for the actual diff.\n');
process.stdout.write('- Use one todo file for large or collision-prone intent and handoff context.\n');
process.stdout.write('- Use a short branch plus linked worktree only when isolation lowers collision risk.\n');
