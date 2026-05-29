import Image from 'next/image';
import { walletLogoSrc } from '@/lib/brand';

export const metadata = {
    title: 'Download veyl',
};

const lockScrollScript = `
document.documentElement.style.overflow = 'hidden';
document.documentElement.style.overscrollBehavior = 'none';
document.body.style.overflow = 'hidden';
document.body.style.overscrollBehavior = 'none';
`;

export default function DownloadPage() {
    return (
        <main className="relative flex h-dvh items-center justify-center overflow-hidden overscroll-none px-6 py-10">
            <script dangerouslySetInnerHTML={{ __html: lockScrollScript }} />
            <section className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
                <Image src={walletLogoSrc} alt="" width={128} height={128} className="size-32" loading="eager" unoptimized />
                <div className="space-y-2">
                    <h1 className="text-2xl">download the app</h1>
                    <p className="text-muted">get veyl on the App Store or use the browser version on desktop.</p>
                </div>
            </section>
        </main>
    );
}
