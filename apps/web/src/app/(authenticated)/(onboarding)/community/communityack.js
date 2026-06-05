'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader } from 'lucide-react';
import { COMMUNITY_RULES_DATE, COMMUNITY_RULES_EFFECTIVE, COMMUNITY_RULES_VERSION, COMMUNITY_SECTIONS } from '@veyl/shared/community';
import { Button } from '@/components/button';
import { cloud } from '@/lib/cloud';

export default function CommunityAck() {
    const router = useRouter();
    const bodyRef = useRef(null);
    const [canAccept, setCanAccept] = useState(false);
    const [status, setStatus] = useState('idle');
    const isSubmitting = status === 'submitting';
    const isError = status === 'error';
    const titleText = isSubmitting ? 'saving acknowledgement' : 'community rules';

    const handleScroll = useCallback(
        (event) => {
            if (canAccept) return;
            const el = event.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
                setCanAccept(true);
            }
        },
        [canAccept]
    );

    useEffect(() => {
        const el = bodyRef.current;
        if (el && el.scrollHeight <= el.clientHeight + 24) {
            setCanAccept(true);
        }
    }, []);

    const accept = useCallback(async () => {
        const uid = cloud.auth.user?.uid;
        if (isSubmitting || !canAccept) return;
        if (!uid) {
            setStatus('error');
            return;
        }

        setStatus('submitting');
        try {
            await cloud.user.community.accept(uid, { version: COMMUNITY_RULES_VERSION, date: COMMUNITY_RULES_DATE });
            router.refresh();
        } catch (error) {
            console.warn('community rules acknowledgement failed', error);
            setStatus('error');
        }
    }, [canAccept, isSubmitting, router]);

    return (
        <main className="absolute inset-0 overflow-hidden">
            <div ref={bodyRef} className="h-full overflow-y-auto px-4 pt-20 pb-26 select-text" onScroll={handleScroll}>
                <div className="mx-auto grid w-full max-w-xl gap-4">
                    {COMMUNITY_SECTIONS.map((section) => (
                        <section key={section.title} className="grid gap-2.5 rounded-round bg-background/70 px-4.5 py-4.5 shadow backdrop-blur-sm">
                            <h2 className="text-xl font-black">{section.title}</h2>
                            {section.body.map((line) => (
                                <p key={line} className="text-[15px] leading-[23px] text-foreground">
                                    {line}
                                </p>
                            ))}
                        </section>
                    ))}
                </div>
            </div>

            <header className="pointer-events-none absolute inset-x-0 top-0 bg-background/70 shadow backdrop-blur-sm">
                <div className="grid min-h-16 w-full grid-cols-[56px_minmax(0,1fr)_56px] items-center px-4">
                    <div />
                    <div className="min-w-0 text-center">
                        <h1 className="flex items-center justify-center gap-2 text-2xl font-extrabold leading-tight" aria-live="polite">
                            {titleText}
                            {isSubmitting ? <Loader className="mt-0.5 animate-spin" /> : null}
                        </h1>
                        <div className="text-xs font-bold text-muted">
                            issued {COMMUNITY_RULES_EFFECTIVE}
                        </div>
                    </div>
                    <div />
                </div>
            </header>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 py-5">
                <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2">
                    {isError && (
                        <p className="pointer-events-auto rounded-full bg-background/90 px-3 py-1.5 text-sm font-black text-destructive shadow backdrop-blur-sm">
                            Could not save your acknowledgement. Try again.
                        </p>
                    )}
                    <div className="relative h-10 min-w-48">
                        <div className="pop absolute inset-0" data-open={!isSubmitting} aria-hidden={isSubmitting}>
                            <Button type="button" className="button-fill shrinker pointer-events-auto w-full" disabled={!canAccept || isSubmitting} onClick={accept} tabIndex={isSubmitting ? -1 : 0}>
                                agree & continue
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
