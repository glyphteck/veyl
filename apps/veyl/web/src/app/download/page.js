import { walletLogoSrc } from '@/lib/brand';

export const metadata = {
    title: 'Download veyl',
};

export default function DownloadPage() {
    return (
        <main className="min-h-screen px-6 py-10 flex items-center justify-center">
            <section className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
                <img src={walletLogoSrc} alt="" className="size-32" />
                <div className="space-y-2">
                    <h1 className="text-2xl">download the app</h1>
                    <p className="text-muted">get veyl on the appstore or use the browser version on desktop.</p>
                </div>
            </section>
        </main>
    );
}
