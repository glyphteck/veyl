'use client';

import { Card } from '@/components/card';
import { Button } from '@/components/button';
import { rules } from '@glyphteck/shared/password';

export default function PasswordRules({ close }) {
    return (
        <div className="flex max-w-xl flex-col gap-2">
            <Card className="p-5">
                <div className="flex items-center gap-2 text-2xl font-black">about passwords</div>
                <div className="py-3 text-md">it is always better to use computer generated passwords. it is hard for a human to create randomness, which is the best kind of password.</div>
                <div className="flex flex-col gap-1.5">
                    {rules.map((rule) => (
                        <div key={rule} className="flex gap-1.5 text-md">
                            <span>•</span>
                            <span>{rule}</span>
                        </div>
                    ))}
                </div>
            </Card>
            <Button type="button" className="button-outline shrinker w-full" onClick={close}>
                back
            </Button>
        </div>
    );
}
