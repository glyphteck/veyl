import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const webApps = ['apps/web'];
const iosAppDir = 'apps/ios';
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

function parseVersion(version) {
    const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
        return null;
    }
    return match.slice(1).map((part) => Number(part));
}

function compareVersions(left, right) {
    for (let i = 0; i < 3; i += 1) {
        if (left[i] !== right[i]) {
            return left[i] - right[i];
        }
    }
    return 0;
}

function rangeAllowsVersion(range, version) {
    const parsedVersion = parseVersion(version);
    if (!parsedVersion) {
        return false;
    }

    return String(range).split('||').some((part) => {
        const term = part.trim();
        if (term === '*' || term === version) {
            return true;
        }

        const operator = term[0];
        const target = parseVersion(term.replace(/^[~^]/, ''));
        if (!target) {
            return false;
        }

        if (operator === '^') {
            return parsedVersion[0] === target[0] && compareVersions(parsedVersion, target) >= 0;
        }

        if (operator === '~') {
            return parsedVersion[0] === target[0] && parsedVersion[1] === target[1] && compareVersions(parsedVersion, target) >= 0;
        }

        return compareVersions(parsedVersion, target) === 0;
    });
}

function syncNextPeers() {
    let failed = false;
    const rootPkg = readJson(resolve(rootDir, 'package.json'));
    const catalog = rootPkg.workspaces?.catalog || {};

    for (const app of webApps) {
        const pkgPath = resolve(rootDir, app, 'package.json');
        const pkg = readJson(pkgPath);
        const nextPkg = readJson(resolvePackage('next', app));
        const nextPeers = nextPkg.peerDependencies || {};
        const expected = {
            react: catalog.react,
            'react-dom': catalog['react-dom'],
        };

        for (const [name, version] of Object.entries(expected)) {
            if (!version) {
                throw new Error(`root workspace catalog does not declare ${name}`);
            }

            const nextPeer = nextPeers[name];
            if (!nextPeer) {
                throw new Error(`next@${nextPkg.version} does not declare a ${name} peer dependency`);
            }

            if (!rangeAllowsVersion(nextPeer, version)) {
                throw new Error(`root catalog ${name}@${version} does not satisfy next@${nextPkg.version} peer ${nextPeer}`);
            }

            const current = pkg.dependencies?.[name];
            if (current === 'catalog:') {
                continue;
            }

            if (check) {
                console.error(`${app}: ${name} is ${current || 'missing'}, expected catalog: backed by ${version} from the root workspace catalog`);
                failed = true;
                continue;
            }

            pkg.dependencies[name] = 'catalog:';
            console.log(`${app}: set ${name} to catalog: backed by ${version} from the root workspace catalog`);
        }

        if (!check) {
            writeJson(pkgPath, pkg);
        }
    }

    return failed ? 1 : 0;
}

function runExpoInstall() {
    const args = ['x', 'expo', 'install', ...expoManagedPackages, check ? '--check' : '--fix'];
    const result = spawnSync('bun', args, { cwd: resolve(rootDir, iosAppDir), stdio: 'inherit' });
    return result.status || 0;
}

const webStatus = syncNextPeers();
const expoStatus = runExpoInstall();
process.exitCode = webStatus || expoStatus;
