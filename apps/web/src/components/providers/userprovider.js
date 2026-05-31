'use client';

import { createUserProvider } from '@veyl/shared/providers/userprovider';
import { resolveNetwork } from '@veyl/shared/network';
import { auth, db, getStorage } from '@/lib/firebase/firebaseclient';
import { userAvatarCache } from '@/lib/user/avatarcache';

const { UserProvider, useUser } = createUserProvider({
    auth,
    db,
    getStorage,
    network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
    avatarCache: userAvatarCache,
});

export { UserProvider, useUser };
