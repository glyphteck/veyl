import '@/app/globals.css';
import { Notifications } from '@/components/notifications';
import { ThemeProvider } from '@/components/themeprovider';
import { links } from '@glyphteck/shared/links';

export const metadata = {
    metadataBase: new URL(links.veyl),
    title: {
        default: 'veyl',
        template: '%s | veyl',
    },
    description: 'veyl is a passkey-first Bitcoin wallet and encrypted chat app from Glyphteck.',
    keywords: ['veyl', 'Glyphteck', 'Gliftec', 'Bitcoin wallet', 'Spark wallet', 'encrypted chat', 'passkey wallet'],
    alternates: {
        canonical: '/',
    },
    openGraph: {
        title: 'veyl',
        description: 'A passkey-first Bitcoin wallet and encrypted chat app from Glyphteck.',
        url: '/',
        siteName: 'veyl',
        images: [{ url: '/wallet.png', width: 512, height: 512, alt: 'veyl wallet' }],
        type: 'website',
    },
    twitter: {
        card: 'summary',
        title: 'veyl',
        description: 'A passkey-first Bitcoin wallet and encrypted chat app from Glyphteck.',
        images: ['/wallet.png'],
    },
    icons: {
        icon: '/wallet.png',
        shortcut: '/wallet.png',
        apple: '/wallet.png',
    },
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body suppressHydrationWarning className="select-none font-bold antialiased">
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
                    {children}
                    <Notifications position="bottom-left" />
                </ThemeProvider>
            </body>
        </html>
    );
}
