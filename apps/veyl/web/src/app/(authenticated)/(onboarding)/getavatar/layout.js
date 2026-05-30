'use client';

import { OnboardingGate } from '@/lib/routeguards';

export default function GetAvatarLayout({ children }) {
    return <OnboardingGate step="avatar">{children}</OnboardingGate>;
}
