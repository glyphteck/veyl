'use client';

import { OnboardingGate } from '@/lib/routeguards';

export default function GetUsernameLayout({ children }) {
    return <OnboardingGate step="username">{children}</OnboardingGate>;
}
