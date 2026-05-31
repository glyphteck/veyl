import { createSearch } from '@veyl/shared/search/hook';
import { createProfileSource } from '@veyl/shared/search/source';
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
        // Main menu: only `@<token>` engages profile search so free text keeps
        // filtering local menu actions.
        mainmenu: createProfileSource({ remote: profileQueries, mode: 'mainmenu' }),
        // Profile-only fields: bare text = username, `@<role>` = role.
        profiles: createProfileSource({ remote: profileQueries, mode: 'profiles' }),
    },
});
