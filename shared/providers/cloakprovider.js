'use client';

import { createContext, useContext, useMemo, useState } from 'react';

const CloakContext = createContext(null);

export function CloakProvider({ children }) {
    const [cloaked, setCloaked] = useState(false);
    const cloak = () => setCloaked((v) => !v);
    const value = useMemo(() => ({ cloaked, cloak }), [cloaked]);

    return <CloakContext value={value}>{children}</CloakContext>;
}

export function useCloak() {
    const ctx = useContext(CloakContext);
    if (!ctx) throw new Error('useCloak must be used inside CloakProvider');
    return ctx;
}
