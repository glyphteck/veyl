'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getFunctions } from '@/lib/firebase/firebaseclient';
import { httpsCallable } from 'firebase/functions';
import { Input } from '@/components/input';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader, TriangleAlert } from 'lucide-react';
import { MAX_USERNAME, cleanUsername, isUsername, isUsernameKey, isUsernameTakenError, normalizeUsername } from '@veyl/shared/username';

const usernameSchema = z.object({
    username: z.string().refine(isUsername),
});

const GetUsername = () => {
    const router = useRouter();
    const resetRef = useRef(null);

    // state for loading and error
    const [status, setStatus] = useState('idle');
    let labelText = 'choose a username';
    let showLoader = status === 'submitting';
    let showInvalid = status === 'invalid';
    let showUnavailable = status === 'unavailable' || status === 'taken';
    const disabled = status === 'submitting';
    if (status === 'submitting') labelText = 'verifying username';
    if (status === 'invalid') labelText = 'choose a different username';
    if (status === 'unavailable') labelText = 'username unavailable';
    if (status === 'taken') labelText = 'username taken';

    const form = useForm({
        resolver: zodResolver(usernameSchema),
        defaultValues: { username: '' },
        mode: 'onChange',
    });

    const usernameValue = form.watch('username');
    useEffect(() => {
        if (showUnavailable && !usernameValue) return;
        clearTimeout(resetRef.current);
        const result = usernameSchema.safeParse({ username: usernameValue });
        if (!result.success && usernameValue) setStatus('invalid');
        else setStatus('idle');
    }, [showUnavailable, usernameValue]);

    useEffect(() => {
        return () => clearTimeout(resetRef.current);
    }, []);

    const onSubmit = async ({ username: raw }) => {
        const username = normalizeUsername(raw);
        const valid = usernameSchema.safeParse({ username }).success;
        if (!username || !valid) return;

        clearTimeout(resetRef.current);
        setStatus('submitting');

        try {
            await httpsCallable(getFunctions(), 'setUsername')({ username });
            router.refresh();
        } catch (err) {
            form.reset({ username: '' });
            setStatus(isUsernameTakenError(err) ? 'taken' : 'unavailable');
            clearTimeout(resetRef.current);
            resetRef.current = setTimeout(() => {
                setStatus('idle');
            }, 1500);
        }
    };

    return (
        <div className="pointer-events-auto select-none inset-0 absolute items-center flex justify-center">
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <Controller
                    control={form.control}
                    name="username"
                    render={({ field, fieldState }) => (
                        <div className="flex flex-col w-full gap-2">
                            <label htmlFor="username" className="flex items-center gap-2 px-3 text-xl font-black leading-none select-none">
                                {labelText}
                                {(showInvalid || showUnavailable) && <TriangleAlert className="mt-0.5" />}
                                {showLoader && <Loader className="mt-0.5 animate-spin" />}
                            </label>
                            <Input
                                {...field}
                                id="username"
                                aria-invalid={fieldState.invalid}
                                ref={field.ref}
                                start={<span className="text-xl font-black">@</span>}
                                startPad="pl-9"
                                className="min-w-80"
                                disabled={disabled}
                                type="text"
                                maxLength={MAX_USERNAME}
                                placeholder="username"
                                autoFocus
                                required
                                spellCheck="false"
                                autoCorrect="off"
                                onKeyDown={(e) => {
                                    if ([8, 9, 27, 13, 37, 38, 39, 40, 46].includes(e.keyCode)) {
                                        return;
                                    }
                                    if ((e.ctrlKey || e.metaKey) && [65, 67, 86, 88, 90].includes(e.keyCode)) {
                                        return;
                                    }
                                    if (!isUsernameKey(e.key)) {
                                        e.preventDefault();
                                    }
                                }}
                                onChange={(e) => {
                                    field.onChange(cleanUsername(e.target.value));
                                }}
                                onPaste={(e) => {
                                    const paste = e.clipboardData.getData('text');
                                    e.preventDefault();
                                    field.onChange(cleanUsername(`${field.value || ''}${paste}`));
                                }}
                            />
                        </div>
                    )}
                />
            </form>
        </div>
    );
};

export default GetUsername;
