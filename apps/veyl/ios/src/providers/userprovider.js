import { createUserProvider } from '@glyphteck/shared/providers/userprovider';
import { resolveNetwork } from '@glyphteck/shared/network';
import { auth, db, storage } from '@/lib/firebase';
import { userAvatarCache } from '@/lib/useravatarcache';
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
