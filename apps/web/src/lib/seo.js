import { links } from '@veyl/shared/links';

export const appDescription = 'Veyl is a passkey-first Bitcoin wallet and end-to-end encrypted chat app from Glyphteck Corp.';

export function JsonLd({ data, nonce }) {
    const json = JSON.stringify(data).replace(/</g, '\\u003c');

    return (
        <script type="application/ld+json" nonce={nonce || undefined} suppressHydrationWarning>
            {json}
        </script>
    );
}

export function veylSoftwareApplicationSchema({ url = links.veyl } = {}) {
    return {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'veyl',
        alternateName: ['Veyl', 'veyl by Glyphteck'],
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Web, iOS',
        url,
        description: appDescription,
        offers: {
            '@type': 'Offer',
            price: 0,
            priceCurrency: 'USD',
        },
        publisher: {
            '@type': 'Organization',
            name: 'Glyphteck Corp',
            url: links.root,
        },
    };
}
