'use client';

import { useCallback, useState, useEffect } from 'react';
import { makeUserQr, qr } from '@veyl/shared/qr';
import Loading from '@/components/loading';
import { useChat } from '@/components/providers/chatprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { useUser } from '@/components/providers/userprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { cloud } from '@/lib/cloud';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@/components/input';
import { Controller, useForm } from 'react-hook-form';
import { Lock, Unlock, Loader, AlertCircle, Eye, EyeOff, ShieldUser } from 'lucide-react';
import { Button } from '@/components/button';
import { logout } from '@/lib/user/actions';
import { yieldToUi } from '@veyl/shared/utils/async';
import { isPassword, MAX_PASSWORD, normalizePassword } from '@veyl/shared/password';
import { isVaultIncompatibleError } from '@veyl/shared/crypto/seed';
import RegtestTag from '@/components/regtesttag';
import UserMenu from '@/components/usermenu';

const passwordSchema = z.object({
    password: z.string().refine((value) => isPassword(value)),
});

const lockLabels = {
    unlocking: 'unlocking',
    decrypting: 'decrypting vault',
    'seed-decrypted': 'vault decrypted',
    migrating: 'migrating vault',
    deriving: 'deriving keys',
    wallet: 'opening wallet',
    chat: 'opening chat',
    launching: 'launching app',
};

const unlockIconCrossfadeMs = 500;
const unlockIconTransition = { transitionDuration: `${unlockIconCrossfadeMs}ms` };

function UnlockInputIcon({ decrypted, error }) {
    return (
        <span className="pointer-events-none relative flex size-5 select-none items-center justify-center" aria-hidden="true">
            <Lock
                className={`absolute inset-0 size-5 transition-opacity ease-out ${decrypted ? 'opacity-0' : 'opacity-100'} ${error ? 'text-destructive' : ''}`}
                style={unlockIconTransition}
            />
            <Unlock
                className={`absolute inset-0 size-5 text-active transition-opacity ease-out ${decrypted ? 'opacity-100' : 'opacity-0'}`}
                style={unlockIconTransition}
            />
        </span>
    );
}

export default function UnlockPage() {
    const { unlock, lockState } = useVault();
    const { isChatDataReady } = useChat();
    const { openDialog } = useDialog();
    const user = useUser();
    const [status, setStatus] = useState('idle');
    const [showPassword, setShowPassword] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [seedDecrypted, setSeedDecrypted] = useState(false);
    const username = user?.username;
    const isUnlocked = lockState === 'unlocked';
    const isOpeningChats = isUnlocked && !isChatDataReady;
    const lockLabel = lockLabels[lockState];
    const lockPending = !!lockLabel || isUnlocked;
    const disabled = status === 'loading' || status === 'error' || lockPending;
    const showError = status === 'error' || status === 'incompatible';
    const showPending = !showError && (status === 'loading' || lockPending);
    let labelText = lockLabel || (status === 'loading' ? 'unlocking' : 'unlock your vault');
    if (isUnlocked) labelText = isOpeningChats ? 'opening chats' : 'launching app';
    if (status === 'error') labelText = 'wrong password';
    if (status === 'incompatible') labelText = 'vault reset required';

    const form = useForm({
        resolver: zodResolver(passwordSchema),
        defaultValues: { password: '' },
        mode: 'onChange',
    });

    const togglePasswordVisibility = () => setShowPassword((prev) => !prev);
    const animateUnlockIcon = useCallback(
        () =>
            new Promise((resolve) => {
                setSeedDecrypted(true);
                setTimeout(resolve, unlockIconCrossfadeMs);
            }),
        []
    );
    const openUserQr = useCallback(() => {
        const qrData = makeUserQr(username);
        if (!qrData) return;
        setUserMenuOpen(false);
        openDialog('qrcode', {
            type: qr.user,
            value: qrData,
        });
    }, [openDialog, username]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
                e.preventDefault();
                if (disabled) return;
                if (e.shiftKey) {
                    openUserQr();
                } else {
                    setUserMenuOpen(true);
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l' && e.shiftKey) {
                e.preventDefault();
                logout();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [disabled, openUserQr]);

    const onSubmit = async ({ password: raw }) => {
        setSeedDecrypted(false);
        setStatus('loading');
        await yieldToUi();
        const password = normalizePassword(raw);
        if (!isPassword(password)) return;
        if (!cloud.auth.user?.uid) return;
        try {
            await unlock(password, { onSeedDecrypted: animateUnlockIcon });
        } catch (error) {
            setSeedDecrypted(false);
            if (isVaultIncompatibleError(error)) {
                setStatus('incompatible');
                form.reset({ password: '' });
                return;
            }
            setStatus('error');
            setTimeout(() => {
                setStatus('idle');
                form.reset({ password: '' });
            }, 1000);
        }
    };

    if (!user.uid) return <Loading />;

    return (
        <div className="pointer-events-auto inset-0 fixed items-center flex justify-center">
            {user?.isAdmin ? <ShieldUser className="stroke-2 pointer-events-none absolute top-2.25 left-2 z-20 size-10 text-active" /> : null}
            <div className="pop absolute top-2.25 right-2 z-20 flex items-center gap-2" data-open={!showPending} aria-hidden={showPending}>
                <RegtestTag />
                <UserMenu
                    user={user}
                    openDialog={openDialog}
                    locked
                    disabled={disabled}
                    open={userMenuOpen}
                    onOpenChange={setUserMenuOpen}
                    className="shrinker-fixed disabled:opacity-100"
                    avatarClassName="size-11 shadow"
                />
            </div>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <Controller
                    control={form.control}
                    name="password"
                    render={({ field, fieldState }) => (
                        <div className="flex flex-col w-full gap-2">
                            <div className="flex items-center gap-2 px-3">
                                <label htmlFor="unlock-password" className="flex items-center gap-2 text-xl font-black leading-none select-none">
                                    {labelText}
                                    {showError ? <AlertCircle className="mt-0.5" /> : showPending ? <Loader className="mt-0.5 animate-spin!" /> : null}
                                </label>
                            </div>
                            <Input
                                {...field}
                                id="unlock-password"
                                aria-describedby="unlock-password-help"
                                aria-invalid={fieldState.invalid}
                                ref={field.ref}
                                start={<UnlockInputIcon decrypted={seedDecrypted} error={showError} />}
                                end={
                                    !showPending ? (
                                        <Button
                                            type="button"
                                            onClick={togglePasswordVisibility}
                                            disabled={disabled}
                                            className="grower-lg text-muted hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {showPassword ? <Eye /> : <EyeOff />}
                                        </Button>
                                    ) : null
                                }
                                disabled={disabled}
                                className="w-xs"
                                type={showPassword ? 'text' : 'password'}
                                maxLength={MAX_PASSWORD}
                                placeholder="password"
                                autoFocus
                                required
                                spellCheck="false"
                                autoCorrect="off"
                            />
                            <p id="unlock-password-help" className="text-muted">
                                Your funds are{' '}
                                <span className="group relative inline-flex align-baseline">
                                    <Button
                                        type="button"
                                        className="h-auto rounded-none p-0 underline transition-colors hover:text-foreground focus-visible:text-foreground"
                                    >
                                        safe
                                    </Button>
                                    <span
                                        role="tooltip"
                                        className="pointer-events-none absolute top-full left-1/2 z-50 mt-3 w-2xs max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-round bg-background/85 px-4 py-2.5 text-left text-foreground opacity-0 shadow backdrop-blur-sm transition-opacity ease-out group-hover:opacity-100 group-focus-within:opacity-100"
                                    >
                                        Your chats and funds are encrypted locally and accessible only with your password.
                                    </span>
                                </span>{' '}
                                here.
                            </p>
                        </div>
                    )}
                />
            </form>
        </div>
    );
}
