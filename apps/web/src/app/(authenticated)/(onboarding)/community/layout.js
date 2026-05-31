'use client';

import { OnboardingGate } from '@/lib/routeguards';

export default function CommunityLayout({ children }) {
    return <OnboardingGate step="community">{children}</OnboardingGate>;
}
