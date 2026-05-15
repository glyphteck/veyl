'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/button';
import { Loader, Fingerprint, UserRoundPlus } from 'lucide-react';
import { toast } from 'sonner';
import { isPasskeyEnvironmentMismatchError, isPasskeyRpMismatchError, passkeyLogin } from '@/lib/passkey';

function isUnlinkedPasskeyError(error) {
    return error?.code === 'passkey-unlinked';
}

export default function LoginPage() {
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    async function login() {
        if (isLoading) return;
        try {
            setIsLoading(true);
            await passkeyLogin();
            router.push('/unlock');
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                setIsLoading(false);
                return;
            }
            if (isUnlinkedPasskeyError(error)) {
                toast.error('This passkey is not linked to an account.', {
                    description: 'Create a new account or use a different passkey.',
                });
                setIsLoading(false);
                return;
            }
            if (isPasskeyEnvironmentMismatchError(error)) {
                toast.error('This passkey belongs to glyphteck.com, not localhost.', {
                    description: 'Use a localhost passkey here, or run the app on a glyphteck.com host to use your existing passkey.',
                });
                setIsLoading(false);
                return;
            }
            if (isPasskeyRpMismatchError(error)) {
                toast.error('This passkey is from the old Gliftec passkey setup.', {
                    description: 'Create a new account or register a new passkey on this build.',
                });
                setIsLoading(false);
                return;
            }
            console.error('Login failed:', error);
            setIsLoading(false);
        }
    }

    if (isLoading) {
        return (
            <div className=" h-screen flex items-center justify-center">
                <Loader className="size-8 animate-spin" />
            </div>
        );
    }
    return (
        <div className="h-screen flex items-center justify-center">
            <div className="flex flex-col gap-2 items-center">
                <img src="/wallet.png" className="mb-4 size-64" />
                <Button onClick={login} disabled={isLoading} className="w-3xs shrinker button-fill">
                    <Fingerprint />
                    login
                </Button>
                <Button onClick={() => router.push('/newaccount')} disabled={isLoading} variant="ghost" className="w-3xs shrinker">
                    <UserRoundPlus />
                    new account
                </Button>
            </div>
        </div>
    );
}
