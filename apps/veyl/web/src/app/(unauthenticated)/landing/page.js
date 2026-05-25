import Link from 'next/link';
import { headers } from 'next/headers';
import { userAgent } from 'next/server';
import { ArrowRight, HatGlasses, KeyRound, Lock, MessageCircle, Smartphone, Wallet } from 'lucide-react';
import { btclogo, gtlogo, usdblogo } from '@glyphteck/shared/logos';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { walletLogoSrc } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { Graph } from './graph';

export const metadata = {
    title: {
        absolute: 'veyl',
    },
    description: 'veyl is private communication and fast, secure Bitcoin payments in one app.',
};

const points = [
    {
        icon: Lock,
        title: 'safety first',
        body: 'anonymous accounts. all you need is a passkey and a password. you own your account, chats and wallet, and can delete it all anytime.',
    },
    {
        icon: MessageCircle,
        title: 'private communication',
        body: 'fully end-to-end encrypted chats. send text, photos, audio, video, files, and payment requests to anyone with an account.',
    },
    {
        icon: Wallet,
        title: 'fast and free payments',
        body: 'built on bitcoin. you get the security and ownership you deserve, without the fees and latency.',
    },
];

const sections = [
    {
        icon: MessageCircle,
        icon2: KeyRound,
        title: 'chat without a paper trail',
        body: 'chat privately with anyone on veyl. every message is encrypted and can only be seen by you and the recipient. messages are automatically deleted from our servers after 21 days, unless you save them.',
        shots: { web: null, ios: null },
    },
    {
        icon: Wallet,
        logos: [
            { src: btclogo, alt: 'bitcoin' },
            { src: usdblogo, alt: 'usdb', hidden: true },
        ],
        title: 'bitcoin that moves like money',
        body: 'self custodial spark wallets. your seed never leaves your device. transfer real bitcoin in seconds, for free. lightning compatible. support for stablecoins and more coming soon.',
        shots: { web: null, ios: null },
    },
    {
        icon: Lock,
        icon2: HatGlasses,
        title: 'on security and privacy',
        body: 'our servers mind their own business. not yours. anonymous accounts protect your identity, and your data never leaves your device unencrypted. you can delete your account anytime, and all your data is wiped from our servers.',
        shots: { web: null, ios: null },
    },
];

function landingDevice(agent) {
    const type = agent.device.type || 'desktop';
    const ua = agent.ua || '';
    const appDevice = type === 'mobile' || type === 'tablet';
    const iphone = agent.os.name === 'iOS' && /iphone/i.test(`${agent.device.model || ''} ${ua}`);

    return { appDevice, iphone };
}

async function getLandingDevice() {
    return landingDevice(userAgent({ headers: await headers() }));
}

function landingCta(device) {
    if (device.appDevice) {
        return {
            href: '/download',
            label: 'download for ios',
            icon: Smartphone,
        };
    }

    return {
        href: '/login',
        label: 'take back my freedom',
        icon: ArrowRight,
    };
}

function FeatureMark({ icon: Icon, icon2: Icon2, logos }) {
    const visibleLogos = logos?.filter((logo) => !logo.hidden);

    if (logos) {
        return (
            <div className="flex items-center gap-2">
                <div className="flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow">
                    <Icon className="size-6" />
                </div>
                <div className="flex items-center gap-2">
                    {visibleLogos.map((logo) => (
                        <img key={logo.alt} src={logo.src} alt={logo.alt} className="size-12 rounded-full shadow" />
                    ))}
                </div>
            </div>
        );
    }

    if (Icon2) {
        return (
            <div className="flex items-center gap-2">
                <div className="flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow">
                    <Icon className="size-6" />
                </div>
                <div className="flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow">
                    <Icon2 className="size-6" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow">
            <Icon className="size-6" />
        </div>
    );
}

function FeatureCard({ icon, icon2, logos, title, body }) {
    return (
        <Card className="h-full gap-4 p-4 md:p-5">
            <FeatureMark icon={icon} icon2={icon2} logos={logos} />
            <div className="space-y-2">
                <h2 className="text-xl font-black">{title}</h2>
                <p className="text-sm text-muted md:text-base">{body}</p>
            </div>
        </Card>
    );
}

function FeatureShot({ shots, device }) {
    const shot = device.iphone ? shots?.ios : shots?.web;

    return (
        <Card aria-hidden="true" className={cn(device.iphone ? 'mx-auto h-auto aspect-[9/16] min-h-0 w-full max-w-[17rem]' : 'aspect-[4/3] min-h-[22rem] md:min-h-[28rem]')}>
            {shot?.src ? <img src={shot.src} alt="" className="h-full w-full object-cover" /> : null}
        </Card>
    );
}

function FeatureSection({ icon, icon2, logos, title, body, shots, device, reverse = false }) {
    return (
        <section className="grid items-center gap-6 md:gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className={cn('max-w-xl space-y-4', reverse && 'lg:order-2 lg:ml-auto')}>
                <FeatureMark icon={icon} icon2={icon2} logos={logos} />
                <div className="space-y-3">
                    <h2 className="text-3xl font-black leading-none md:text-5xl">{title}</h2>
                    <p className="text-base leading-7 text-foreground md:text-lg">{body}</p>
                </div>
            </div>
            <div className={cn(device.iphone && 'flex justify-center', reverse && 'lg:order-1')}>
                <FeatureShot shots={shots} device={device} />
            </div>
        </section>
    );
}

export default async function LandingPage() {
    const device = await getLandingDevice();
    const cta = landingCta(device);
    const CtaIcon = cta.icon;

    return (
        <main className="relative h-dvh overflow-y-auto overscroll-y-contain bg-background text-foreground">
            <Graph className="pointer-events-none fixed inset-0 z-0 h-dvh w-full" />
            <div className="pointer-events-none fixed inset-0 z-0 bg-background/35" />

            <section className="relative z-10 flex min-h-[86svh] items-start justify-center overflow-hidden px-5 text-center md:min-h-[84svh] md:px-8">
                <div className="relative z-10 flex w-full max-w-3xl flex-col items-center pt-[14vh] md:pt-[16vh]">
                    <img src={walletLogoSrc} alt="" className="pointer-events-none mb-7 size-32 select-none md:size-40" />
                    <h1 className="text-6xl font-black leading-none md:text-8xl">veyl</h1>
                    <p className="mt-5 max-w-2xl text-2xl font-black leading-tight">own your money. chat privately.</p>

                    <Button asChild className="button-fill shrinker mt-8 px-5 py-3 text-base md:px-6 md:text-lg">
                        <Link href={cta.href}>
                            <CtaIcon />
                            {cta.label}
                        </Link>
                    </Button>
                </div>
            </section>

            <section className="relative z-10 mx-auto grid w-full max-w-6xl auto-rows-fr items-stretch gap-4 px-5 pt-8 pb-16 md:grid-cols-3 md:px-8">
                {points.map((point) => (
                    <FeatureCard key={point.title} {...point} />
                ))}
            </section>

            <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-16 px-5 pb-14 md:gap-24 md:px-8 md:pb-20">
                {sections.map((section, index) => (
                    <FeatureSection key={section.title} {...section} device={device} reverse={index % 2 === 1} />
                ))}
            </div>

            <div className="relative z-10 mx-auto flex w-full flex-col items-center gap-8 pb-2 text-xs font-black uppercase tracking-normal text-muted">
                <a href="https://glyphteck.com" aria-label="Glyphteck" className="grower inline-flex">
                    <img src={gtlogo} alt="" className="h-8 w-auto dark:invert md:h-16" />
                </a>
                <span>©2026 Glyphteck Corp.</span>
            </div>
        </main>
    );
}
