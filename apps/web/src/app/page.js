import { describeInvite } from '@veyl/shared/invite';
import { walletLogoSrc } from '@/lib/brand';
import RootClient from './rootclient';

export async function generateMetadata({ searchParams }) {
    const params = await searchParams;
    const copy = describeInvite(params);
    if (!copy) return {};

    return {
        title: copy.title,
        description: copy.body,
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
