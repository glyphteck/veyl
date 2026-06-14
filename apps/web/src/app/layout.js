import '@/app/globals.css';
import { Notifications } from '@/components/notifications';
import { ThemeProvider } from '@/components/themeprovider';
import { links } from '@veyl/shared/links';
import { walletLogoSrc } from '@/lib/brand';
import { appDescription } from '@/lib/seo';
import { headers } from 'next/headers';

export const metadata = {
    metadataBase: new URL(links.veyl),
    title: {
        default: 'veyl by Glyphteck',
        template: '%s | veyl',
    },
    description: appDescription,
    keywords: ['veyl', 'Veyl', 'Glyphteck', 'Glyphteck Corp', 'Bitcoin wallet', 'Spark wallet', 'encrypted chat', 'end-to-end encrypted chat', 'passkey wallet'],
    openGraph: {
        title: 'veyl by Glyphteck',
        description: appDescription,
        url: '/',
        siteName: 'veyl',
        images: [{ url: walletLogoSrc, width: 512, height: 512, alt: 'veyl wallet' }],
        type: 'website',
    },
    twitter: {
        card: 'summary',
        title: 'veyl by Glyphteck',
        description: appDescription,
        images: [walletLogoSrc],
    },
    icons: {
        icon: walletLogoSrc,
        shortcut: walletLogoSrc,
        apple: walletLogoSrc,
    },
};

export default async function RootLayout({ children }) {
    const nonce = (await headers()).get('x-nonce');

    return (
        <html lang="en" suppressHydrationWarning>
            <body suppressHydrationWarning className="select-none font-bold antialiased">
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
                    {children}
                    <Notifications position="bottom-left" />
                </ThemeProvider>
            </body>
        </html>
    );
}
