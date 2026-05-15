'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { Loader } from 'lucide-react';
import { toast } from 'sonner';
import { isPasskeyRpMismatchError, passkeyRegister } from '@/lib/passkey';

function isInvalidPasskeyRegisterError(error) {
    return error?.code === 'passkey-register-invalid';
}

export default function NewAccountPage() {
    const [accountName, setAccountName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const inputRef = useRef(null);

    async function register(label) {
        if (isLoading) return;
        try {
            setIsLoading(true);
            await passkeyRegister({ label });
            window.location.replace('/unlock');
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                setIsLoading(false);
                return;
            }
            if (isPasskeyRpMismatchError(error)) {
                toast.error('This passkey is from a different Gliftec passkey setup.', {
                    description: 'Try again and create a new passkey for the current build.',
                });
                setIsLoading(false);
                return;
            }
            if (isInvalidPasskeyRegisterError(error)) {
                toast.error('Passkey registration failed.', {
                    description: error.message,
                });
                setIsLoading(false);
                return;
            }
            console.error('Registration failed:', error);
            setIsLoading(false);
        }
    }

    if (isLoading) {
        return (
            <div className="h-screen flex items-center justify-center">
                <Loader className="size-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="h-screen flex items-center justify-center" onClick={() => inputRef.current?.focus()}>
            <div className="flex flex-col gap-2 items-start pointer-events-auto select-none">
                <label htmlFor="passkey-name" className="px-3 text-xl font-black leading-none select-none">
                    label your passkey
                </label>
                <Input
                    ref={inputRef}
                    id="passkey-name"
                    className="min-w-80"
                    type="text"
                    placeholder="passkey name"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && accountName.trim()) {
                            register(accountName.trim());
                        }
                    }}
                    disabled={isLoading}
                    autoFocus
                    spellCheck="false"
                    autoCorrect="off"
                />
                <div className="flex flex-col w-full gap-2 mt-2">
                    <Button onClick={() => register(accountName.trim())} disabled={isLoading || !accountName.trim()} className="w-full shrinker button-fill">
                        create account
                    </Button>
                    <Button type="button" variant="ghost" className="grower text-muted hover:text-foreground" disabled={isLoading} onClick={() => register(undefined)}>
                        i don't care
                    </Button>
                </div>
            </div>
        </div>
    );
}
