export const OSS_DEFAULT_REPO_DIR = '../veyl-oss';

export const ossAllowlist = Object.freeze([
    { from: 'oss/README.md', to: 'README.md' },
    { from: 'oss/SECURITY.md', to: 'SECURITY.md' },

    '.gitignore',
    'bun.lock',
    'bunfig.toml',
    'eslint.config.mjs',
    'package.json',
    'vercel.json',

    'apps/web',
    'apps/ios',
    'shared',
    'patches',

    'scripts/dev.mjs',
    'scripts/dirty.mjs',
    'scripts/ios.mjs',
    'scripts/sync-frameworks.mjs',
    'scripts/vercel-build.mjs',
    'scripts/web.mjs',
]);

export const ossExcludedByPolicy = Object.freeze([
    'functions',
    'firestore.rules',
    'firestore.indexes.json',
    'storage.rules',
    'storage.cors.json',
    'storage.lifecycle.json',
    'apps/bot',
    'scripts/admin',
    'scripts/make.mjs',
    'scripts/repo.mjs',
    'costs',
    'todo',
    'bugs.md',
    'repo-remarks.md',
    'review.md',
    'roadmap.md',
    'ideas.md',
    'AGENTS.md',
    'guidelines',
]);
