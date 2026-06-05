import { createUserProvider } from '@veyl/shared/providers/userprovider';
import { resolveNetwork } from '@veyl/shared/network';
import { userAvatarCache } from '@/lib/user/avatarcache';
import { mark } from '@/lib/diagnostics';
import { cloud } from '@/lib/cloud';

const { UserProvider, useUser } = createUserProvider({
    cloud,
    network: resolveNetwork(globalThis?.process?.env ?? {}),
    avatarCache: userAvatarCache,
    diag: mark,
});

export { UserProvider, useUser };
