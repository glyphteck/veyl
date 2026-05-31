import { createSearch } from '@veyl/shared/search/hook';
import { createProfileSource } from '@veyl/shared/search/source';
import { profileQueries } from '@/lib/peers';
import { usePeer } from '@/providers/peerprovider';
import { useUser } from '@/providers/userprovider';

function useSearchContext() {
    return {
        peer: usePeer() || {},
        user: useUser(),
    };
}

export const useSearch = createSearch({
    useSearchContext,
    sources: {
        // Profile-only fields: bare text = username, `@<role>` = role.
        profiles: createProfileSource({ remote: profileQueries, mode: 'profiles' }),
    },
});
