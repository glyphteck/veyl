'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase/firebaseclient';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@/components/input';
import { Controller, useForm } from 'react-hook-form';
import { KeyRound, Loader, Eye, EyeOff, CircleQuestionMark, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/button';
import { useDialog } from '@/components/providers/dialogprovider';
import { packSeedData } from '@glyphteck/shared/crypto/pack';
import { encryptSeed } from '@/lib/crypto/seed';
import { getPasswordFeedback, isPassword, MAX_PASSWORD, normalizePassword } from '@glyphteck/shared/password';

const passwordSchema = z.object({
    password: z.string().refine((value) => isPassword(value)),
});

const GetPsw = () => {
    const router = useRouter();
    const { openDialog } = useDialog();
    const [status, setStatus] = useState('idle');
    const [showPassword, setShowPassword] = useState(false);

    const getLabelText = () => {
        if (status === 'submitting') return 'encrypting your vault';
        if (status === 'invalid') return 'create a different password';
        if (status === 'short') return 'create a longer password';
        return 'create a strong password';
    };

    const labelText = getLabelText();
    const isSubmitting = status === 'submitting';
    const disabled = isSubmitting;
    const showError = status === 'invalid' || status === 'short';

    const form = useForm({
        resolver: zodResolver(passwordSchema),
        defaultValues: { password: '' },
        mode: 'onChange',
    });

    const togglePasswordVisibility = () => {
        setShowPassword(!showPassword);
    };
    const passwordValue = form.watch('password');
    useEffect(() => {
        if (!passwordValue) {
            setStatus('idle');
            return;
        }
        setStatus(getPasswordFeedback(passwordValue).status);
    }, [passwordValue]);

    const onSubmit = async ({ password: raw }) => {
        const password = normalizePassword(raw);
        if (!isPassword(password)) return;
        setStatus('submitting');
        const uid = auth.currentUser?.uid;
        if (!uid) {
            setStatus('idle');
            router.refresh();
            return;
        }
        if ((await getDoc(doc(db, 'seeds', uid))).exists()) {
            router.refresh();
            return;
        }

        try {
            const seedData = await encryptSeed(password);
            await setDoc(doc(db, 'seeds', uid), { es: packSeedData(seedData) });
            router.refresh();
        } catch (error) {
            console.error('Error in encryption process:', error);
            setStatus('idle');
        }
    };

    return (
        <div className="pointer-events-auto select-none inset-0 absolute items-center flex justify-center">
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <Controller
                    control={form.control}
                    name="password"
                    render={({ field, fieldState }) => (
                        <div className="flex flex-col w-full gap-2">
                            <div className="flex min-w-xs items-center justify-between px-3">
                                <label htmlFor="password" className="flex items-center gap-2 text-xl font-black leading-none select-none">
                                    {labelText}
                                    {isSubmitting ? <Loader className="mt-0.5 animate-spin" /> : showError ? <TriangleAlert className="mt-0.5" /> : null}
                                </label>
                                {!isSubmitting ? (
                                    <Button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            openDialog('passwordrules');
                                        }}
                                        disabled={disabled}
                                        className="grower-lg text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="password rules"
                                    >
                                        <CircleQuestionMark />
                                    </Button>
                                ) : null}
                            </div>
                            <Input
                                {...field}
                                id="password"
                                aria-describedby="password-help"
                                aria-invalid={fieldState.invalid}
                                ref={field.ref}
                                start={<KeyRound className={`${status === 'valid' ? 'text-inflow' : showError ? 'text-outflow' : 'text-muted'}`} />}
                                end={
                                    !isSubmitting ? (
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
                                startPad="pl-10"
                                className="min-w-xs"
                                disabled={disabled}
                                type={showPassword ? 'text' : 'password'}
                                maxLength={MAX_PASSWORD}
                                placeholder="password"
                                autoFocus
                                required
                                spellCheck="false"
                                autoCorrect="off"
                            />
                            <p id="password-help" className="text-muted">
                                Keep it safe. It's the{' '}
                                <span className="group relative inline-flex align-baseline">
                                    <Button type="button" className="h-auto rounded-none p-0 underline transition-colors hover:text-foreground focus-visible:text-foreground">
                                        only access
                                    </Button>
                                    <span
                                        role="tooltip"
                                        className="text-foreground pointer-events-none absolute top-full left-1/2 z-50 mt-3 w-2xs max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-round bg-background/85 px-4 py-2.5 text-left opacity-0 shadow backdrop-blur-sm transition-opacity ease-out group-hover:opacity-100 group-focus-within:opacity-100"
                                    >
                                        This password unlocks your encrypted vault. Without it, your funds and chats are unavailable.
                                    </span>
                                </span>{' '}
                                to your vault.
                            </p>
                        </div>
                    )}
                />
            </form>
        </div>
    );
};

export default GetPsw;
