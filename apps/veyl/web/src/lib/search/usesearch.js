import { createSearch } from '@glyphteck/shared/search/hook';
import { createProfileSource } from '@glyphteck/shared/search/source';
import { profileQueries } from '@/lib/peers';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';

function useSearchContext() {
    return {
        peer: usePeer() || {},
        user: useUser(),
    };
}

export const useSearch = createSearch({
    useSearchContext,
    sources: {
        // Web command palette: only `@<token>` engages a profile search so
        // free-text typing keeps driving the cmdk filter.
        mainmenu: createProfileSource({ remote: profileQueries, mode: 'mainmenu' }),
        // Profile-only fields: bare text = username, `@<role>` = role.
        profiles: createProfileSource({ remote: profileQueries, mode: 'profiles' }),
    },
});
