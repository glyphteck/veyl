import { describeInvite } from '@veyl/shared/invite';
import { walletLogoSrc } from '@/lib/brand';
import RootClient from './rootclient';

export async function generateMetadata({ searchParams }) {
    const params = await searchParams;
    const copy = describeInvite(params);
    if (!copy) {
        return {
            title: {
                absolute: 'veyl by Glyphteck',
            },
            description: 'Veyl is a passkey-first Bitcoin wallet and end-to-end encrypted chat app from Glyphteck Corp.',
            alternates: {
                canonical: '/join',
            },
            openGraph: {
                title: 'veyl by Glyphteck',
                description: 'A private Bitcoin wallet and encrypted chat app from Glyphteck Corp.',
                url: '/join',
                siteName: 'veyl',
                images: [{ url: walletLogoSrc, width: 512, height: 512, alt: 'veyl' }],
                type: 'website',
            },
            twitter: {
                card: 'summary',
                title: 'veyl by Glyphteck',
                description: 'A private Bitcoin wallet and encrypted chat app from Glyphteck Corp.',
                images: [walletLogoSrc],
            },
        };
    }

    return {
        title: copy.title,
        description: copy.body,
        alternates: {
            canonical: '/',
        },
        openGraph: {
            title: copy.title,
            description: copy.body,
            url: '/',
            siteName: 'veyl',
            images: [{ url: walletLogoSrc, width: 512, height: 512, alt: 'veyl' }],
            type: 'website',
        },
        twitter: {
            card: 'summary',
            title: copy.title,
            description: copy.body,
            images: [walletLogoSrc],
        },
    };
}

export default function Root() {
    return <RootClient />;
}
