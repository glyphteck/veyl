import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const REGTEST_BRANCH = 'regtest';
const branch = process.env.VERCEL_GIT_COMMIT_REF || '';
const isRegtest = branch === REGTEST_BRANCH;
const env = {
    ...process.env,
    NEXT_PUBLIC_NETWORK: isRegtest ? 'REGTEST' : 'MAINNET',
    NEXT_PUBLIC_VEYL_VARIANT: isRegtest ? 'test' : 'prod',
};
const bun = join(env.HOME || process.env.HOME, '.bun', 'bin', 'bun');
const result = spawnSync(bun, ['--filter', '@glyphteck/veyl-web', 'build'], {
    env,
    stdio: 'inherit',
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
