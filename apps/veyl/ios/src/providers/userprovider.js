import { createUserProvider } from '@glyphteck/shared/providers/userprovider';
import { resolveNetwork } from '@glyphteck/shared/network';
import { auth, db, storage } from '@/lib/firebase';

const { UserProvider, useUser } = createUserProvider({
    auth,
    db,
    storage,
    network: resolveNetwork(globalThis?.process?.env ?? {}),
});

export { UserProvider, useUser };
