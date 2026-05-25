'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { StaticAvatar } from '@/components/avatar';
import { toast } from 'sonner';
import { isPasskeyRpMismatchError, passkeyRegister } from '@/lib/passkey';
import { cn } from '@/lib/utils';

const PASSKEY_AVATAR_SUCCESS_MS = 500;
const PASSKEY_AVATAR_PULSE_MS = 1600;

function isInvalidPasskeyRegisterError(error) {
    return error?.code === 'passkey-register-invalid';
}

function PasskeyAvatarStatus({ state }) {
    const visible = state !== 'idle';
    const success = state === 'success';

    return (
        <div className={cn('pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity ease-out', visible ? 'opacity-100' : 'opacity-0')} aria-hidden={!visible}>
            <div className="relative size-18">
                <StaticAvatar
                    className={cn('absolute inset-0 size-18 text-foreground shadow-sm transition-opacity duration-500 ease-out [&_svg]:scale-[1.12]', visible && !success ? 'animate-pulse opacity-100' : 'opacity-0')}
                    style={{ animationDuration: `${PASSKEY_AVATAR_PULSE_MS}ms` }}
                />
                <StaticAvatar className={cn('absolute inset-0 size-18 text-active shadow-sm transition-opacity duration-500 ease-out [&_svg]:scale-[1.12]', success ? 'opacity-100' : 'opacity-0')} />
            </div>
        </div>
    );
}

export default function NewAccountPage() {
    const router = useRouter();
    const [accountName, setAccountName] = useState('');
    const [authState, setAuthState] = useState('idle');
    const registeringRef = useRef(false);
    const isLoading = authState !== 'idle';
    const hidden = isLoading;
    const createDisabled = isLoading || !accountName.trim();

    async function register(label) {
        if (registeringRef.current) return;
        registeringRef.current = true;
        const registration = passkeyRegister({ label });
        try {
            setAuthState('preparing');
            await registration;
            setAuthState('success');
            await new Promise((resolve) => setTimeout(resolve, PASSKEY_AVATAR_SUCCESS_MS));
            router.refresh();
        } catch (error) {
            registeringRef.current = false;
            if (error.name === 'NotAllowedError') {
                setAuthState('idle');
                return;
            }
            if (isPasskeyRpMismatchError(error)) {
                toast.error('This passkey is from a different Glyphteck passkey setup.', {
                    description: 'Try again and create a new passkey for the current build.',
                });
                setAuthState('idle');
                return;
            }
            if (isInvalidPasskeyRegisterError(error)) {
                toast.error('Passkey registration failed.', {
                    description: error.message,
                });
                setAuthState('idle');
                return;
            }
            console.error('Registration failed:', error);
            setAuthState('idle');
        }
    }

    return (
        <div className="relative h-screen flex items-center justify-center">
            <div className={`flex flex-col gap-2 items-start select-none transition-opacity ease-out ${hidden ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'}`} aria-hidden={hidden}>
                <label htmlFor="account-name" className="px-3 text-xl font-black leading-none select-none">
                    name your account
                </label>
                <Input
                    id="account-name"
                    className="min-w-80 disabled:!opacity-100"
                    type="text"
                    placeholder="account name"
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
                    <Button onClick={() => register(accountName.trim())} disabled={createDisabled} className={`w-full shrinker button-fill ${isLoading ? 'disabled:!opacity-100' : ''}`}>
                        create account
                    </Button>
                    <Button type="button" variant="ghost" className="grower text-muted hover:text-foreground disabled:!opacity-100" disabled={isLoading} onClick={() => register(undefined)}>
                        i don't care
                    </Button>
                </div>
            </div>
            <PasskeyAvatarStatus state={authState} />
        </div>
    );
}
