'use client';

import { createUserProvider } from '@glyphteck/shared/providers/userprovider';
import { resolveNetwork } from '@glyphteck/shared/network';
import { auth, db, getStorage } from '@/lib/firebase/firebaseclient';
import { userAvatarCache } from '@/lib/useravatarcache';

const { UserProvider, useUser } = createUserProvider({
    auth,
    db,
    getStorage,
    network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
    avatarCache: userAvatarCache,
});

export { UserProvider, useUser };
