import '@/app/globals.css';
import { Notifications } from '@/components/notifications';
import { ThemeProvider } from '@/components/themeprovider';
import { links } from '@veyl/shared/links';
import { walletLogoSrc } from '@/lib/brand';
import { headers } from 'next/headers';

export const metadata = {
    metadataBase: new URL(links.veyl),
    title: {
        default: 'veyl',
        template: '%s | veyl',
    },
    description: 'veyl is a passkey-first Bitcoin wallet and encrypted chat app from Glyphteck.',
    keywords: ['veyl', 'Glyphteck', 'Bitcoin wallet', 'Spark wallet', 'encrypted chat', 'passkey wallet'],
    alternates: {
        canonical: '/',
    },
    openGraph: {
        title: 'veyl',
        description: 'A passkey-first Bitcoin wallet and encrypted chat app from Glyphteck.',
        url: '/',
        siteName: 'veyl',
        images: [{ url: walletLogoSrc, width: 512, height: 512, alt: 'veyl wallet' }],
        type: 'website',
    },
    twitter: {
        card: 'summary',
        title: 'veyl',
        description: 'A passkey-first Bitcoin wallet and encrypted chat app from Glyphteck.',
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
