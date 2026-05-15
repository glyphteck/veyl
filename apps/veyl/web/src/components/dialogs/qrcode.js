'use client';
import { QRCodeSVG } from 'qrcode.react';
import { makeQr, qr } from '@glyphteck/shared/qrutils';
import { resolveNetwork } from '@glyphteck/shared/network';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Card } from '@/components/card';
import { useUser } from '@/components/providers/userprovider';

export default function QRCodeDialog({ data }) {
    const { avatar, username, active } = useUser();
    const qrValue = makeQr(data);
    const network = resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK });
    const isTestEnv = network !== 'MAINNET';
    const isUserQr = data?.type === qr.user;
    const title = username ? `@${username}` : 'share your veyl';
    const body =
        data?.type === qr.bitcoin
            ? 'send bitcoin to this address to fund your account. this is a normal bitcoin transaction. it will take around 30 minutes to confirm, and you will pay fees on it.'
            : data?.type === qr.user
              ? 'share your account to receive money or connect with people faster.'
              : '';

    if (!qrValue) return null;

    return (
        <div className="flex flex-col items-center gap-4">
            {isUserQr ? (
                <div className="flex items-center gap-3">
                    <Avatar active={!!active} className="size-14">
                        <AvatarImage src={avatar} alt={title} />
                        <AvatarFallback />
                    </Avatar>
                    <p className="text-3xl font-black">{title}</p>
                </div>
            ) : null}
            <QRCodeSVG value={qrValue} bgColor="transparent" fgColor="oklch(0 0 0)" className="dark:invert size-85" />
            {body ? (
                <Card className="w-full max-w-lg p-4">
                    <p className="text-center font-black text-lg">{body}</p>
                    {data?.type === qr.bitcoin && isTestEnv ? (
                        <div className="mt-2 flex items-center justify-center">
                            <p className="text-center text-md font-black text-destructive uppercase">you are currently in test environment. do not send real bitcoin to this address.</p>
                        </div>
                    ) : null}
                </Card>
            ) : null}
        </div>
    );
}
