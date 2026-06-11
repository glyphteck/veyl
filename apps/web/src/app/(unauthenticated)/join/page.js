import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';
import { userAgent } from 'next/server';
import { ArrowRight, HatGlasses, KeyRound, Lock, MessageCircle, Smartphone, Wallet } from 'lucide-react';
import { btclogo, gtlogo, usdblogo } from '@veyl/shared/logos';
import { slogan } from '@veyl/shared/product';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { walletLogoSrc } from '@/lib/brand';
import { cn } from '@/lib/classes';
import { FeatureJump } from './featurejump';
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
        target: 'security-and-privacy',
    },
    {
        icon: MessageCircle,
        title: 'private communication',
        body: 'fully end-to-end encrypted chats. send text, photos, audio, video, files, and payment requests to anyone with an account.',
        target: 'chat-without-a-paper-trail',
    },
    {
        icon: Wallet,
        title: 'fast and free payments',
        body: 'built on bitcoin. you get the security and ownership you deserve, without the fees and latency.',
        target: 'bitcoin-that-moves-like-money',
    },
];

const sections = [
    {
        id: 'chat-without-a-paper-trail',
        icon: MessageCircle,
        icon2: KeyRound,
        title: 'chat without a paper trail',
        body: 'chat privately with anyone on veyl. every message is encrypted and can only be seen by you and the recipient. messages are automatically deleted from our servers after 21 days, unless you save them.',
        shots: { web: null, ios: null },
    },
    {
        id: 'bitcoin-that-moves-like-money',
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
        id: 'security-and-privacy',
        icon: Lock,
        icon2: HatGlasses,
        title: 'security and privacy',
        body: 'our servers mind their own business. not yours. anonymous accounts protect your identity, and your data never leaves your device unencrypted. you can delete your account anytime, and all your data is wiped from our servers.',
        shots: { web: null, ios: null },
    },
];

function joinDevice(agent) {
    const type = agent.device.type || 'desktop';
    const ua = agent.ua || '';
    const appDevice = type === 'mobile' || type === 'tablet';
    const iphone = agent.os.name === 'iOS' && /iphone/i.test(`${agent.device.model || ''} ${ua}`);

    return { appDevice, iphone };
}

async function getJoinDevice() {
    return joinDevice(userAgent({ headers: await headers() }));
}

function joinCta(device) {
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

function featureShot(shots, device) {
    return device.iphone ? shots?.ios : shots?.web;
}

function FeatureMark({ icon: Icon, icon2: Icon2, logos, markClassName }) {
    const visibleLogos = logos?.filter((logo) => !logo.hidden);

    if (logos) {
        return (
            <div className="flex items-center gap-3">
                <div className={cn('flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow', markClassName)}>
                    <Icon className="size-6" />
                </div>
                <div className="flex items-center gap-2">
                    {visibleLogos.map((logo) => (
                        <Image key={logo.alt} src={logo.src} alt={logo.alt} width={48} height={48} className="size-12 rounded-full shadow" unoptimized />
                    ))}
                </div>
            </div>
        );
    }

    if (Icon2) {
        return (
            <div className="flex items-center gap-3">
                <div className={cn('flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow', markClassName)}>
                    <Icon className="size-6" />
                </div>
                <div className={cn('flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow', markClassName)}>
                    <Icon2 className="size-6" />
                </div>
            </div>
        );
    }

    return (
        <div className={cn('flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow', markClassName)}>
            <Icon className="size-6" />
        </div>
    );
}

function FeatureCard({ icon, icon2, logos, title, body, target }) {
    return (
        <FeatureJump target={target}>
            <Card className="h-full gap-4 p-4 md:p-5">
                <FeatureMark icon={icon} icon2={icon2} logos={logos} markClassName="transition-transform group-hover:scale-120 group-focus-visible:scale-120 group-active:scale-85" />
                <div className="space-y-2">
                    <h2 className="text-xl font-black">{title}</h2>
                    <p className="text-sm text-muted md:text-base">{body}</p>
                </div>
            </Card>
        </FeatureJump>
    );
}

function FeatureShot({ shot, iphone }) {
    return (
        <Card aria-hidden="true" className={cn('relative', iphone ? 'mx-auto h-auto aspect-[9/16] min-h-0 w-full max-w-[17rem]' : 'aspect-[4/3] min-h-[22rem] md:min-h-[28rem]')}>
            <Image src={shot.src} alt="" className="object-cover" fill sizes={iphone ? '17rem' : '(min-width: 768px) 672px, 100vw'} unoptimized />
        </Card>
    );
}

function FeatureSection({ id, icon, icon2, logos, title, body, shots, device, reverse = false }) {
    const shot = featureShot(shots, device);
    const hasShot = !!shot?.src;

    return (
        <section id={id} className={cn('grid scroll-mt-8 items-center gap-6 md:gap-8', hasShot && 'lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]')}>
            <div className={cn('max-w-xl space-y-4', hasShot && reverse && 'lg:order-2 lg:ml-auto')}>
                <FeatureMark icon={icon} icon2={icon2} logos={logos} />
                <div className="space-y-3">
                    <h2 className="text-3xl font-black leading-none md:text-5xl">{title}</h2>
                    <p className="text-base leading-7 text-foreground md:text-lg">{body}</p>
                </div>
            </div>
            {hasShot ? (
                <div className={cn(device.iphone && 'flex justify-center', reverse && 'lg:order-1')}>
                    <FeatureShot shot={shot} iphone={device.iphone} />
                </div>
            ) : null}
        </section>
    );
}

export default async function JoinPage() {
    const device = await getJoinDevice();
    const cta = joinCta(device);
    const CtaIcon = cta.icon;

    return (
        <main className="relative h-dvh overflow-y-auto overscroll-y-contain bg-background text-foreground">
            <Graph className="pointer-events-none fixed inset-0 z-0 h-dvh w-full" />
            <div className="pointer-events-none fixed inset-0 z-0 bg-background/35" />

            <section className="relative z-10 flex min-h-[86svh] items-start justify-center overflow-hidden px-5 text-center md:min-h-[84svh] md:px-8">
                <div className="relative z-10 flex w-full max-w-3xl flex-col items-center pt-[14vh] md:pt-[16vh]">
                    <Image src={walletLogoSrc} alt="" width={160} height={160} className="pointer-events-none mb-7 size-32 select-none md:size-40" loading="eager" unoptimized />
                    <h1 className="text-6xl font-black leading-none md:text-8xl">veyl</h1>
                    <p className="mt-5 max-w-2xl text-2xl font-black leading-tight">{slogan}</p>

                    <Button asChild className="button-fill shrinker mt-8 px-5 py-3 text-base md:px-6 md:text-lg">
                        <Link href={cta.href}>
                            {cta.label}
                            <CtaIcon />
                        </Link>
                    </Button>
                </div>
            </section>

            <section className="relative z-10 mx-auto grid w-full max-w-6xl auto-rows-fr items-stretch gap-4 px-5 pt-8 pb-16 md:grid-cols-3 md:px-8">
                {points.map((point) => (
                    <FeatureCard key={point.title} {...point} />
                ))}
            </section>

            <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-16 px-5 md:gap-24 md:px-8">
                {sections.map((section, index) => (
                    <FeatureSection key={section.title} {...section} device={device} reverse={index % 2 === 1} />
                ))}
            </div>

            <div className="relative z-10 mx-auto h-dvh w-full text-muted">
                <a href="https://glyphteck.com" aria-label="Glyphteck" className="grower absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2">
                    <Image src={gtlogo} alt="" width={128} height={64} className="h-auto w-16 dark:invert md:w-32" style={{ height: 'auto' }} unoptimized />
                </a>
                <div className="pointer-events-none absolute bottom-2 inset-x-0 z-10 flex h-6 items-center px-1 text-xs font-black uppercase text-muted">
                    <span className="absolute left-1/2 -translate-x-1/2">©2026 Glyphteck Corp.</span>
                </div>
            </div>
        </main>
    );
}
