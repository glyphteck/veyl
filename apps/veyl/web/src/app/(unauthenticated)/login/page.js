'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/button';
import { Fingerprint, Loader, UserRoundPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { isPasskeyEnvironmentMismatchError, isPasskeyRpMismatchError, passkeyLogin } from '@/lib/passkey';
import { userAvatarCache } from '@/lib/useravatarcache';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Card } from '@/components/card';
import { walletLogoSrc } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { Graph } from '../landing/graph';

function isUnlinkedPasskeyError(error) {
    return error?.code === 'passkey-unlinked';
}

function createFakeQuickAccounts() {
    return process.env.NODE_ENV === 'production'
        ? []
        : Array.from({ length: 5 }, (_, index) => ({
              uid: `fake-quick-account-${index + 1}`,
              username: `fake${index + 1}`,
              avatar: null,
              fake: true,
          }));
}

export default function LoginPage() {
    const [loadingKey, setLoadingKey] = useState(null);
    const [authState, setAuthState] = useState('idle');
    const [remembered, setRemembered] = useState([]);
    const [fakeAccounts, setFakeAccounts] = useState(createFakeQuickAccounts);
    const router = useRouter();
    const isLoading = !!loadingKey;
    const accounts = [...(remembered || []), ...fakeAccounts];
    const isPasskeyLoading = authState !== 'idle';
    const loaderText = authState === 'preparing' ? 'preparing passkey...' : authState === 'success' ? 'signing in...' : 'waiting for passkey...';

    async function loadRemembered() {
        const accounts = await userAvatarCache.listRemembered?.();
        setRemembered(accounts || []);
    }

    useEffect(() => {
        let active = true;

        async function load() {
            try {
                const accounts = await userAvatarCache.listRemembered?.();
                if (active) setRemembered(accounts || []);
            } catch {
                if (active) setRemembered([]);
            }
        }

        void load();

        return () => {
            active = false;
        };
    }, []);

    async function login(uid = null) {
        if (isLoading) return;
        const key = uid || 'login';
        try {
            setLoadingKey(key);
            setAuthState('preparing');
            await passkeyLogin({ uid, onPrompt: () => setAuthState('prompt') });
            setAuthState('success');
            if (uid) {
                await userAvatarCache.touchLogin?.(uid);
            }
            router.push('/unlock');
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                setLoadingKey(null);
                setAuthState('idle');
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
                setAuthState('idle');
                return;
            }
            if (isPasskeyEnvironmentMismatchError(error)) {
                toast.error('This passkey belongs to glyphteck.com, not localhost.', {
                    description: 'Use a localhost passkey here, or run the app on a glyphteck.com host to use your existing passkey.',
                });
                setLoadingKey(null);
                setAuthState('idle');
                return;
            }
            if (isPasskeyRpMismatchError(error)) {
                toast.error('This passkey is from the old Gliftec passkey setup.', {
                    description: 'Create a new account or register a new passkey on this build.',
                });
                setLoadingKey(null);
                setAuthState('idle');
                return;
            }
            console.error('Login failed:', error);
            setLoadingKey(null);
            setAuthState('idle');
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
        if (uid.startsWith('fake-quick-account-')) {
            setFakeAccounts((current) => current.filter((account) => account.uid !== uid));
            return;
        }
        await userAvatarCache.forget?.(uid);
        setRemembered((current) => (Array.isArray(current) ? current.filter((account) => account.uid !== uid) : current));
    }

    return (
        <div className="relative min-h-dvh overflow-y-auto bg-background text-foreground">
            <Graph className="pointer-events-none fixed inset-0 z-0 h-dvh w-full" />
            <div className="pointer-events-none fixed inset-0 z-0 bg-background/35" />
            <div className="relative z-10 mx-auto flex min-h-dvh w-full flex-col items-center px-5 pt-[14vh] md:pt-[16vh]">
                <img src={walletLogoSrc} className="pointer-events-none mb-4 size-32 select-none md:size-40" alt="" />
                {isPasskeyLoading ? (
                    <div className="flex items-center gap-2 text-muted">
                        <Loader className="size-8 animate-spin" />
                        <p className="text-lg font-black">{loaderText}</p>
                    </div>
                ) : null}
                <div className={cn('fixed bottom-[12vh] left-1/2 flex w-3xs -translate-x-1/2 flex-col gap-2 transition-opacity ease-out md:bottom-[14vh]', isLoading ? 'pointer-events-none opacity-0' : 'opacity-100')}>
                    {accounts.length ? (
                        <Card className={accounts.length === 1 ? 'rounded-full' : null}>
                            <div className={cn('max-h-42 overflow-y-auto', accounts.length === 1 ? 'py-0' : 'py-0.5')}>
                                <div className={accounts.length > 1 ? 'divide-y' : null}>
                                    {accounts.map((account) => (
                                        <div
                                            key={account.uid}
                                            role="button"
                                            tabIndex={isLoading ? -1 : 0}
                                            aria-disabled={isLoading}
                                            onClick={() => {
                                                if (!account.fake) login(account.uid);
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                                event.preventDefault();
                                                if (!account.fake) login(account.uid);
                                            }}
                                            className={cn(
                                                'group flex w-full cursor-pointer items-center gap-2 text-left aria-disabled:pointer-events-none',
                                                accounts.length === 1 ? 'py-[7px] pr-1.5 pl-[9px]' : 'py-2 pr-1 pl-3'
                                            )}
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
            </div>
        </div>
    );
}
