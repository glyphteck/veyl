'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/button';
import { Fingerprint, UserRoundPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { isPasskeyEnvironmentMismatchError, isPasskeyRpMismatchError, passkeyLogin } from '@/lib/passkey';
import { userAvatarCache } from '@/lib/useravatarcache';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Card } from '@/components/card';

function isUnlinkedPasskeyError(error) {
    return error?.code === 'passkey-unlinked';
}

export default function LoginPage() {
    const [loadingKey, setLoadingKey] = useState(null);
    const [remembered, setRemembered] = useState(null);
    const router = useRouter();
    const isLoading = !!loadingKey;
    const uiReady = Array.isArray(remembered);
    const accounts = remembered || [];

    const loadRemembered = async () => {
        const accounts = await userAvatarCache.listRemembered?.();
        setRemembered(accounts || []);
    };

    useEffect(() => {
        void loadRemembered().catch(() => {});
    }, []);

    async function login(uid = null) {
        if (isLoading) return;
        const key = uid || 'login';
        try {
            setLoadingKey(key);
            await passkeyLogin({ uid });
            if (uid) {
                await userAvatarCache.touchLogin?.(uid);
            }
            router.push('/unlock');
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                setLoadingKey(null);
                return;
            }
            if (isUnlinkedPasskeyError(error)) {
                toast.error('passkey not recognized', {
                    description: 'This account was probably deleted.',
                });
                if (uid) {
                    await userAvatarCache.forget?.(uid);
                    await loadRemembered().catch(() => {});
                }
                setLoadingKey(null);
                return;
            }
            if (isPasskeyEnvironmentMismatchError(error)) {
                toast.error('This passkey belongs to glyphteck.com, not localhost.', {
                    description: 'Use a localhost passkey here, or run the app on a glyphteck.com host to use your existing passkey.',
                });
                setLoadingKey(null);
                return;
            }
            if (isPasskeyRpMismatchError(error)) {
                toast.error('This passkey is from the old Gliftec passkey setup.', {
                    description: 'Create a new account or register a new passkey on this build.',
                });
                setLoadingKey(null);
                return;
            }
            console.error('Login failed:', error);
            setLoadingKey(null);
        }
    }

    function newAccount() {
        if (isLoading) return;
        setLoadingKey('newaccount');
        router.push('/newaccount');
    }

    async function forget(uid, event = null) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (isLoading || !uid) return;
        await userAvatarCache.forget?.(uid);
        setRemembered((current) => (Array.isArray(current) ? current.filter((account) => account.uid !== uid) : current));
    }

    return (
        <div className="h-screen overflow-y-auto">
            <img src="/wallet.png" className="pointer-events-none fixed top-[calc(50%-260px)] left-1/2 size-64 -translate-x-1/2 select-none" alt="" />
            {uiReady ? (
                <div className={`fixed top-[calc(50%+20px)] left-1/2 flex w-3xs -translate-x-1/2 flex-col gap-2 transition-opacity ${isLoading ? 'pointer-events-none opacity-0' : 'opacity-100'}`} aria-hidden={isLoading}>
                    {accounts.length ? (
                        <Card>
                            <div className="max-h-42 overflow-y-auto py-0.5">
                                <div className="divide-y">
                                    {accounts.map((account) => (
                                        <div
                                            key={account.uid}
                                            role="button"
                                            tabIndex={isLoading ? -1 : 0}
                                            aria-disabled={isLoading}
                                            onClick={() => login(account.uid)}
                                            onKeyDown={(event) => {
                                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                                event.preventDefault();
                                                login(account.uid);
                                            }}
                                            className="group flex w-full cursor-pointer items-center gap-2 py-2 pr-1 pl-3 text-left aria-disabled:pointer-events-none"
                                        >
                                            <Avatar className="grower size-8 shadow">
                                                <AvatarImage src={account.avatar} alt={account.username || 'account'} />
                                                <AvatarFallback />
                                            </Avatar>
                                            <span className="min-w-0 flex-1 truncate text-md font-black">{account.username ? `@${account.username}` : 'account'}</span>
                                            <Button
                                                type="button"
                                                onClick={(event) => forget(account.uid, event)}
                                                disabled={isLoading}
                                                className="grower-lg relative z-10 size-8 text-muted hover:text-foreground disabled:opacity-100"
                                                aria-label={`forget ${account.username || 'account'}`}
                                                title="forget account"
                                            >
                                                <X className="size-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </Card>
                    ) : null}
                    {accounts.length ? <div className="h-2" /> : null}
                    <Button onClick={() => login()} disabled={isLoading} className="w-3xs shrinker button-fill disabled:opacity-100">
                        <Fingerprint />
                        login
                    </Button>
                    <Button onClick={newAccount} disabled={isLoading} variant="ghost" className="w-3xs shrinker disabled:opacity-100">
                        <UserRoundPlus />
                        new account
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
