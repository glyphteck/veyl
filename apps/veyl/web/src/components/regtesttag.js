'use client';

import { cn } from '@/lib/utils';
import { isMainnet, resolveNetwork } from '@glyphteck/shared/network';

const network = resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK });

export default function RegtestTag({ className }) {
    if (isMainnet(network)) return null;

    return (
        <span className={cn('select-none rounded-full bg-destructive/12 px-2 py-1 text-[11px] leading-none font-black text-destructive shadow-sm', className)}>
            regtest
        </span>
    );
}
