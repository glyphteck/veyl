import Link from 'next/link';
import { ArrowRight, Lock, MessageCircle, Smartphone, Wallet } from 'lucide-react';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { walletLogoSrc } from '@/lib/brand';
import { Graph } from './graph';

export const metadata = {
    title: {
        absolute: 'veyl',
    },
    description: 'veyl is private communication and fast, secure Bitcoin payments in one app.',
};

const points = [
    {
        icon: MessageCircle,
        title: 'private communication',
        body: 'fully end-to-end encrypted chats. share any file. anonymously. with anyone. messages are automatically deleted after 21 days.',
    },
    {
        icon: Lock,
        title: 'security first',
        body: 'anonymous accounts. all you need is a passkey and password. you own your account, chats, and wallet, and can delete it all in one click.',
    },
    {
        icon: Wallet,
        title: 'fast and free payments',
        body: 'built on bitcoin. you get the security and ownership you deserve, without the fees and latency.',
    },
];

function FeatureCard({ icon: Icon, title, body }) {
    return (
        <Card className="h-full gap-4 p-4 md:p-5">
            <div className="flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow">
                <Icon className="size-6" />
            </div>
            <div className="space-y-2">
                <h2 className="text-xl font-black">{title}</h2>
                <p className="text-sm text-muted md:text-base">{body}</p>
            </div>
        </Card>
    );
}

export default function LandingPage() {
    return (
        <main className="relative h-dvh overflow-y-auto overscroll-y-contain bg-background text-foreground">
            <Graph className="pointer-events-none fixed inset-0 z-0 h-dvh w-full" />
            <div className="pointer-events-none fixed inset-0 z-0 bg-background/35" />

            <section className="relative z-10 flex min-h-[86svh] items-start justify-center overflow-hidden px-5 text-center md:min-h-[84svh] md:px-8">
                <div className="relative z-10 flex w-full max-w-3xl flex-col items-center pt-[14vh] md:pt-[16vh]">
                    <img src={walletLogoSrc} alt="" className="pointer-events-none mb-7 size-32 select-none md:size-40" />
                    <h1 className="text-6xl font-black leading-none md:text-8xl">veyl</h1>
                    <p className="mt-5 max-w-2xl text-2xl font-black leading-tight">own your money. chat privately.</p>

                    <Button asChild className="button-fill shrinker mt-8 px-5 py-3 text-base md:hidden">
                        <Link href="/download">
                            <Smartphone />
                            download for ios
                        </Link>
                    </Button>
                    <Button asChild className="button-fill shrinker mt-8 hidden px-6 py-3 text-lg md:inline-flex">
                        <Link href="/login">
                            take back my freedom
                            <ArrowRight />
                        </Link>
                    </Button>
                </div>
            </section>

            <section className="relative z-10 mx-auto grid w-full max-w-6xl auto-rows-fr items-stretch gap-4 px-5 pt-8 pb-16 md:grid-cols-3 md:px-8">
                {points.map((point) => (
                    <FeatureCard key={point.title} {...point} />
                ))}
            </section>
        </main>
    );
}
