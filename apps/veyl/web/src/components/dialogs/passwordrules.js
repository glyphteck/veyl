'use client';

import { Card } from '@/components/card';
import { Button } from '@/components/button';
import { rules } from '@glyphteck/shared/password';
import { X } from 'lucide-react';

export default function PasswordRules({ close }) {
    return (
        <Card className="max-w-xl p-5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-2xl font-black">about passwords</div>
                <Button type="button" className="grower-lg text-muted hover:text-foreground" onClick={close} title="close password rules">
                    <X />
                </Button>
            </div>
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
    );
}
