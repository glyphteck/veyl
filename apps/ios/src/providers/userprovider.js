import { createUserProvider } from '@veyl/shared/providers/userprovider';
import { resolveNetwork } from '@veyl/shared/network';
import { auth, db, storage } from '@/lib/firebase';
import { userAvatarCache } from '@/lib/user/avatarcache';
import { mark } from '@/lib/diagnostics';

const { UserProvider, useUser } = createUserProvider({
    auth,
    db,
    storage,
    network: resolveNetwork(globalThis?.process?.env ?? {}),
    avatarCache: userAvatarCache,
    diag: mark,
});

export { UserProvider, useUser };
