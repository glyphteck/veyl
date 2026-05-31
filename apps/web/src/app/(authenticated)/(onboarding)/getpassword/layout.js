'use client';

import { OnboardingGate } from '@/lib/routeguards';

export default function GetPasswordLayout({ children }) {
    return <OnboardingGate step="password">{children}</OnboardingGate>;
}
