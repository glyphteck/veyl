'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase/firebaseclient';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@/components/input';
import { Controller, useForm } from 'react-hook-form';
import { KeyRound, Loader, Eye, EyeOff, CircleQuestionMark } from 'lucide-react';
import { Button } from '@/components/button';
import { useDialog } from '@/components/providers/dialogprovider';
import { packSeedData } from '@glyphteck/shared/crypto/pack';
import { encryptSeed } from '@/lib/crypto/seed';
import { getPasswordError, isPassword, MAX_PASSWORD, normalizePassword } from '@glyphteck/shared/password';

const passwordSchema = z.object({
    password: z.string().refine((value) => isPassword(value)),
});

const GetPsw = () => {
    const router = useRouter();
    const { openDialog } = useDialog();
    const inputRef = useRef(null);
    const [status, setStatus] = useState('idle');
    const [showPassword, setShowPassword] = useState(false);

    const getLabelText = () => {
        if (status === 'submitting') return 'encrypting your password';
        if (status === 'invalid') return 'create a different password';
        return 'create a strong password';
    };

    const labelText = getLabelText();
    const disabled = status === 'submitting';
    const showError = status === 'invalid';

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
        const error = getPasswordError(passwordValue);
        if (!error) {
            setStatus('valid');
            return;
        }

        setStatus('invalid');
    }, [passwordValue]);

    //focus on page load
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const onSubmit = async ({ password: raw }) => {
        const password = normalizePassword(raw);
        if (!isPassword(password)) return;
        setStatus('submitting');
        console.log('Starting encryption process...');
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        if ((await getDoc(doc(db, 'seeds', uid))).exists()) return;

        try {
            console.log('Encrypting seed...');
            const seedData = await encryptSeed(password);
            console.log('Encryption completed, saving to database...');
            await setDoc(doc(db, 'seeds', uid), { es: packSeedData(seedData) });
            console.log('Saved to database, refreshing route...');
            router.refresh();
        } catch (error) {
            console.error('Error in encryption process:', error);
            setStatus('idle');
        }
    };

    return (
        <div className="pointer-events-auto select-none inset-0 absolute items-center flex justify-center" onClick={() => inputRef.current?.focus()}>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <Controller
                    control={form.control}
                    name="password"
                    render={({ field, fieldState }) => (
                        <div className="flex flex-col w-full gap-2">
                            <div className="flex min-w-xs items-center justify-between px-3">
                                <label htmlFor="password" className="text-xl font-black leading-none select-none">
                                    {labelText}
                                </label>
                                {status === 'submitting' ? (
                                    <Loader className="mt-0.5 animate-spin" />
                                ) : (
                                    <Button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            openDialog('passwordrules');
                                        }}
                                        onMouseDown={(e) => e.preventDefault()}
                                        disabled={disabled}
                                        className="grower-lg text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="password rules"
                                    >
                                        <CircleQuestionMark />
                                    </Button>
                                )}
                            </div>
                            <Input
                                {...field}
                                id="password"
                                aria-describedby="password-help"
                                aria-invalid={fieldState.invalid}
                                ref={(el) => {
                                    field.ref(el);
                                    inputRef.current = el;
                                }}
                                start={<KeyRound className={`${!passwordValue ? 'text-muted' : showError ? 'text-outflow' : 'text-inflow'}`} />}
                                end={
                                    <Button
                                        type="button"
                                        onClick={togglePasswordVisibility}
                                        disabled={disabled}
                                        className="grower-lg text-muted hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {showPassword ? <Eye /> : <EyeOff />}
                                    </Button>
                                }
                                startPad="pl-10"
                                className="min-w-xs"
                                disabled={disabled}
                                type={showPassword ? 'text' : 'password'}
                                maxLength={MAX_PASSWORD}
                                placeholder="password"
                                required
                                spellCheck="false"
                                autoCorrect="off"
                            />
                            <p id="password-help" className="text-muted">
                                Keep it safe. It's the{' '}
                                <span className="group relative inline-flex align-baseline">
                                    <button type="button" className="underline transition-colors hover:text-foreground focus-visible:text-foreground">
                                        only access
                                    </button>
                                    <span
                                        role="tooltip"
                                        className="text-foreground pointer-events-none absolute top-full left-1/2 z-50 mt-3 w-2xs max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-round bg-background/85 px-4 py-2.5 text-left opacity-0 shadow backdrop-blur-sm transition-opacity ease-out group-hover:opacity-100 group-focus-within:opacity-100"
                                    >
                                        This password unlocks your encrypted wallet. Without it, your funds are lost forever.
                                    </span>
                                </span>{' '}
                                to your funds.
                            </p>
                        </div>
                    )}
                />
            </form>
        </div>
    );
};

export default GetPsw;
