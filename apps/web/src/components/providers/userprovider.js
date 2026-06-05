'use client';

import { createUserProvider } from '@veyl/shared/providers/userprovider';
import { resolveNetwork } from '@veyl/shared/network';
import { userAvatarCache } from '@/lib/user/avatarcache';
import { cloud } from '@/lib/cloud';

const { UserProvider, useUser } = createUserProvider({
    cloud,
    network: resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK }),
    avatarCache: userAvatarCache,
});

export { UserProvider, useUser };
