import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const webApps = ['apps/veyl/web'];
const iosApp = '@glyphteck/veyl-ios';
const expoManagedPackages = [
    'react',
    'react-dom',
    'react-native',
    '@react-native-async-storage/async-storage',
    'react-native-gesture-handler',
    'react-native-get-random-values',
    'react-native-keyboard-controller',
    'react-native-pager-view',
    'react-native-reanimated',
    'react-native-safe-area-context',
    'react-native-screens',
    'react-native-svg',
    'react-native-worklets',
];

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
    writeFileSync(path, `${JSON.stringify(data, null, 4)}\n`);
}

function resolvePackage(name, cwd) {
    const require = createRequire(resolve(rootDir, cwd, 'package.json'));
    return require.resolve(`${name}/package.json`);
}

function syncNextPeers() {
    let failed = false;

    for (const app of webApps) {
        const pkgPath = resolve(rootDir, app, 'package.json');
        const pkg = readJson(pkgPath);
        const nextPkg = readJson(resolvePackage('next', app));
        const nextPeers = nextPkg.peerDependencies || {};
        const expected = {
            react: nextPeers.react,
            'react-dom': nextPeers['react-dom'],
        };

        for (const [name, version] of Object.entries(expected)) {
            if (!version) {
                throw new Error(`next@${nextPkg.version} does not declare a ${name} peer dependency`);
            }

            const current = pkg.dependencies?.[name];
            if (current === version) {
                continue;
            }

            if (check) {
                console.error(`${app}: ${name} is ${current || 'missing'}, expected ${version} from next@${nextPkg.version}`);
                failed = true;
                continue;
            }

            pkg.dependencies[name] = version;
            console.log(`${app}: set ${name} to ${version} from next@${nextPkg.version}`);
        }

        if (!check) {
            writeJson(pkgPath, pkg);
        }
    }

    return failed ? 1 : 0;
}

function runExpoInstall() {
    const args = ['--filter', iosApp, 'exec', 'expo', 'install', ...expoManagedPackages, check ? '--check' : '--fix'];
    const result = spawnSync('pnpm', args, { cwd: rootDir, stdio: 'inherit' });
    return result.status || 0;
}

const webStatus = syncNextPeers();
const expoStatus = runExpoInstall();
process.exitCode = webStatus || expoStatus;
